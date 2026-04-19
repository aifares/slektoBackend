const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");
const { usernameToEmail } = require("../config/supabaseAdmin");

/**
 * POST /auth/client/login
 *
 * Unified login for both client types:
 *
 * Company (username + password):
 *   { "username": "acme_corp", "password": "..." }
 *
 * Agency (email + password):
 *   { "email": "contact@agency.com", "password": "..." }
 */
router.post("/login", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "password is required" });
    }
    if (!username && !email) {
      return res.status(400).json({ error: "username or email is required" });
    }

    // Resolve to an email address for Supabase signInWithPassword
    const loginEmail = username
      ? usernameToEmail(username.trim())
      : email.trim().toLowerCase();

    const { data: sessionData, error: signInError } =
      await supabase.auth.signInWithPassword({ email: loginEmail, password });

    if (signInError || !sessionData?.session) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const { session, user } = sessionData;

    // Fetch client row
    const { data: clientRow, error: clientError } = await supabase
      .from("client")
      .select("id, name, client_type, username, account_status, role, permissions")
      .eq("user_id", user.id)
      .single();

    if (clientError || !clientRow) {
      return res.status(403).json({ error: "No client account found" });
    }

    if (clientRow.account_status !== "active") {
      return res.status(403).json({
        error: "Account is not active",
        status: clientRow.account_status,
      });
    }

    // Update last_login_at
    await supabase
      .from("client")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", clientRow.id);

    return res.json({
      success: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      client: {
        id: clientRow.id,
        name: clientRow.name,
        client_type: clientRow.client_type,
        username: clientRow.username || null,
        role: clientRow.role,
      },
    });
  } catch (err) {
    console.error("❌ Client login error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * POST /auth/client/refresh
 * Refresh a client session.
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
