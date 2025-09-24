const express = require("express");
const router = express.Router();

// Simple test endpoint without auth
router.get("/", (req, res) => {
  res.json({
    message: "Test endpoint working",
    timestamp: new Date().toISOString(),
  });
});

// Test signup endpoint without auth
router.post("/signup", async (req, res) => {
  try {
    const { supabase } = require("../config/supabase");

    const authHeader =
      req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();

    const { data: userResult, error: userError } = await supabase.auth.getUser(
      accessToken
    );
    if (userError || !userResult?.user) {
      return res.status(401).json({
        error: "Invalid token",
        details: userError?.message,
      });
    }

    const user = userResult.user;
    const email =
      user.email || (user.identities?.[0]?.identity_data?.email ?? null);
    const emailConfirmed = !!user.email_confirmed_at || !!user.confirmed_at;

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

    const { data: clientRow, error: upsertError } = await supabase
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
