const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");
const { supabaseAdmin } = require("../config/supabaseAdmin");
const {
  sendVerification,
  checkVerification,
  toE164,
} = require("../services/twilioService");

// Strip leading +1 to match the local format stored in `drivers.phone` ("9174702290")
function toLocalFormat(e164) {
  return e164.replace(/^\+1/, "");
}

/**
 * POST /auth/driver/send-otp
 * Request an OTP SMS to the driver's phone number via Twilio Verify.
 * Body: { "phone": "9174702290" }
 */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    const e164 = toE164(phone);
    const localPhone = toLocalFormat(e164);

    const { data: driver, error: lookupError } = await supabase
      .from("drivers")
      .select("id, status, name")
      .eq("phone", localPhone)
      .maybeSingle();

    if (lookupError) {
      console.error("❌ Driver phone lookup error:", lookupError);
      return res.status(500).json({ error: "Failed to verify phone number" });
    }

    if (!driver) {
      return res.status(404).json({
        error: "No driver account found for this phone number",
      });
    }

    if (driver.status === "rejected") {
      return res.status(403).json({ error: "Driver application was not approved" });
    }

    if (driver.status === "inactive") {
      return res.status(403).json({ error: "Driver account is inactive" });
    }

    try {
      const verification = await sendVerification(e164);
      console.log(
        `📱 Twilio Verify code sent to driver ${driver.id} at ${e164} (sid=${verification.sid}, status=${verification.status})`
      );
    } catch (twilioErr) {
      console.error("❌ Twilio Verify send error:", twilioErr);
      return res.status(502).json({
        error: "Failed to send verification code",
        details: twilioErr.message,
      });
    }

    return res.json({
      success: true,
      message: "OTP sent",
      // Pending drivers get a heads-up so the frontend can show a friendly message
      pending: driver.status === "pending",
    });
  } catch (err) {
    console.error("❌ Unexpected error in send-otp:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * POST /auth/driver/verify-otp
 * Verify the Twilio code, then mint a Supabase session for the driver.
 * Body: { "phone": "9174702290", "token": "123456" }
 *
 * Strategy: Twilio Verify confirms the user owns the phone. After that,
 * we use the driver's `email` to issue a Supabase session via an admin-generated
 * magic link, which we immediately exchange for an access/refresh token pair.
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, token } = req.body;
    if (!phone || !token) {
      return res.status(400).json({ error: "phone and token are required" });
    }

    const e164 = toE164(phone);
    const localPhone = toLocalFormat(e164);

    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id, name, email, status, auth_user_id")
      .eq("phone", localPhone)
      .maybeSingle();

    if (driverError) {
      console.error("❌ Driver lookup error:", driverError);
      return res.status(500).json({ error: "Failed to look up driver" });
    }

    if (!driver) {
      return res.status(404).json({ error: "No driver account found for this phone number" });
    }

    if (driver.status === "pending") {
      return res.status(403).json({
        error: "Your application is still under review",
        status: "pending",
      });
    }

    if (driver.status === "rejected") {
      return res.status(403).json({ error: "Driver application was not approved" });
    }

    if (driver.status === "inactive") {
      return res.status(403).json({ error: "Driver account is inactive" });
    }

    if (!driver.email) {
      return res.status(500).json({
        error: "Driver record is missing an email address — contact an administrator",
      });
    }

    let twilioResult;
    try {
      twilioResult = await checkVerification(e164, token);
    } catch (twilioErr) {
      console.error("❌ Twilio Verify check error:", twilioErr);
      return res.status(502).json({
        error: "Failed to verify code",
        details: twilioErr.message,
      });
    }

    if (!twilioResult.approved) {
      return res.status(401).json({
        error: "Invalid or expired OTP",
        status: twilioResult.status,
      });
    }

    const driverEmail = driver.email.trim().toLowerCase();

    // Mint a Supabase session by generating a magic link (creates the auth user
    // on first call) and immediately consuming its hashed token.
    let linkData;
    try {
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: driverEmail,
      });
      if (error) throw error;
      linkData = data;
    } catch (linkErr) {
      console.error("❌ Failed to generate magic link for driver:", linkErr);
      return res.status(500).json({
        error: "Failed to issue session",
        details: linkErr.message,
      });
    }

    const tokenHash = linkData?.properties?.hashed_token;
    if (!tokenHash) {
      console.error("❌ Magic link response missing hashed_token", linkData);
      return res.status(500).json({ error: "Failed to issue session" });
    }

    const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });

    if (verifyError || !sessionData?.session || !sessionData?.user) {
      console.error("❌ Magic link verify failed:", verifyError);
      return res.status(500).json({
        error: "Failed to issue session",
        details: verifyError?.message,
      });
    }

    const { session, user } = sessionData;

    // First-time login: link the Supabase auth user to the driver row.
    if (!driver.auth_user_id) {
      const { error: linkError } = await supabaseAdmin
        .from("drivers")
        .update({ auth_user_id: user.id })
        .eq("id", driver.id);

      if (linkError) {
        console.error("❌ Failed to link auth user to driver:", linkError);
        return res.status(500).json({ error: "Failed to link account" });
      }
      console.log(`✅ Driver ${driver.id} (${driver.name}) linked to auth user ${user.id}`);
    }

    return res.json({
      success: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      driver: {
        id: driver.id,
        name: driver.name,
      },
    });
  } catch (err) {
    console.error("❌ Unexpected error in verify-otp:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * POST /auth/driver/refresh
 * Refresh a driver session using a refresh token.
 * Body: { "refresh_token": "..." }
 */
router.post("/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: "refresh_token is required" });
    }

    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if (error || !data?.session) {
      return res.status(401).json({ error: "Failed to refresh session", details: error?.message });
    }

    return res.json({
      success: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

module.exports = router;
