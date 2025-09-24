const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");

function parseAuthToken(req) {
  const authHeader =
    req.headers["authorization"] || req.headers["Authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const cookieHeader = req.headers["cookie"];
  if (cookieHeader) {
    const parts = cookieHeader.split(";").map((p) => p.trim());
    const tokenPair = parts.find((p) => p.startsWith("sb-access-token="));
    if (tokenPair) {
      return decodeURIComponent(tokenPair.split("=")[1]);
    }
  }
  return null;
}

// Public signup endpoint (no auth middleware)
router.post("/signup", async (req, res) => {
  try {
    const accessToken = parseAuthToken(req);
    if (!accessToken) {
      return res.status(401).json({ error: "Missing Supabase access token" });
    }

    const { data: userResult, error: userError } = await supabase.auth.getUser(
      accessToken
    );
    if (userError || !userResult?.user) {
      return res.status(401).json({
        error: "Invalid Supabase access token",
        details: userError?.message,
      });
    }

    const user = userResult.user;
    const email =
      user.email || (user.identities?.[0]?.identity_data?.email ?? null);
    const emailConfirmed = !!user.email_confirmed_at || !!user.confirmed_at;

    // Upsert into client table by user_id (or email as secondary unique)
    const upsertPayload = {
      name:
        req.body?.name ||
        (email ? email.split("@")[0] : `user_${user.id.substring(0, 8)}`),
      user_id: user.id,
      email,
      email_verified: emailConfirmed,
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Try upsert by user_id
    let { data: clientRow, error: upsertError } = await supabase
      .from("client")
      .upsert(upsertPayload, { onConflict: "user_id" })
      .select("*")
      .single();

    if (upsertError) {
      return res.status(500).json({
        error: "Failed to create/update client",
        details: upsertError.message,
      });
    }

    return res.status(200).json({
      message: "Client ensured",
      client: clientRow,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Unexpected error", details: err.message });
  }
});

module.exports = router;
