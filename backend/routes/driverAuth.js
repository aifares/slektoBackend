const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");

// Normalize any local phone format to E.164
// "9174702290" or "19174702290" → "+19174702290"
function toE164(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

// Strip leading +1 to match stored format "9174702290"
function toLocalFormat(e164) {
  return e164.replace(/^\+1/, "");
}

/**
 * POST /auth/driver/send-otp
 * Request an OTP SMS to the driver's phone number.
 * Body: { "phone": "9174702290" }
 */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: "phone is required" });
    }

    const e164 = toE164(phone);

    // Verify a driver record exists for this phone before sending OTP
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

    // Send OTP via Supabase Phone Auth (Supabase calls Twilio internally)
    const { error: otpError } = await supabase.auth.signInWithOtp({ phone: e164 });
    if (otpError) {
      console.error("❌ OTP send error:", otpError);
      return res.status(500).json({
        error: "Failed to send OTP",
        details: otpError.message,
      });
    }

    console.log(`📱 OTP sent to driver ${driver.id} at ${e164}`);
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
 * Verify OTP code, link auth user to driver record on first login, return JWT.
 * Body: { "phone": "9174702290", "token": "123456" }
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { phone, token } = req.body;
    if (!phone || !token) {
      return res.status(400).json({ error: "phone and token are required" });
    }

    const e164 = toE164(phone);

    const { data: sessionData, error: verifyError } =
      await supabase.auth.verifyOtp({ phone: e164, token, type: "sms" });

    if (verifyError || !sessionData?.session) {
      return res.status(401).json({
        error: "Invalid or expired OTP",
        details: verifyError?.message,
      });
    }

    const { session, user } = sessionData;
    const localPhone = toLocalFormat(e164);

    // Fetch the driver row (already pre-validated in send-otp, but verify again)
    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id, name, status, auth_user_id")
      .eq("phone", localPhone)
      .maybeSingle();

    if (driverError || !driver) {
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

    // First-time login: link the Supabase auth user to the driver record
    if (!driver.auth_user_id) {
      const { error: linkError } = await supabase
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
