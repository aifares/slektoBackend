const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");
const { supabaseAdmin, usernameToEmail } = require("../config/supabaseAdmin");

function requireAdmin(req, res, next) {
  if (req.client?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}

router.use(requireAdmin);

/**
 * POST /admin/clients/create
 *
 * Create a client account and immediately link it to an existing campaign.
 * Always requires a campaign_id — accounts are never created without one.
 *
 * client_type "agency":
 *   Admin provides the agency's real email. Supabase sends them a password-reset
 *   link so they set their own password on first login.
 *
 * client_type "company":
 *   Admin sets a username + password directly. The client logs in at
 *   POST /auth/client/login with { username, password }.
 *
 * Body:
 * {
 *   "client_type": "company" | "agency",
 *   "name": "Acme Corp",
 *   "campaign_id": 12,
 *
 *   // company only:
 *   "username": "acme_corp",
 *   "password": "SecurePass123!",
 *
 *   // agency only:
 *   "email": "contact@bigagency.com"
 * }
 */
router.post("/create", async (req, res) => {
  const { client_type, name, campaign_id, username, password, email } = req.body;

  // ── Validate common fields ──
  if (!client_type || !["agency", "company"].includes(client_type)) {
    return res.status(400).json({ error: "client_type must be 'agency' or 'company'" });
  }
  if (!name?.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!campaign_id) {
    return res.status(400).json({ error: "campaign_id is required — accounts must be linked to a campaign" });
  }

  // ── Validate type-specific fields ──
  if (client_type === "company") {
    if (!username?.trim()) return res.status(400).json({ error: "username is required for company accounts" });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }
    // Usernames: alphanumeric + underscores only
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      return res.status(400).json({ error: "username may only contain letters, numbers, and underscores" });
    }
  }

  if (client_type === "agency") {
    if (!email?.trim()) return res.status(400).json({ error: "email is required for agency accounts" });
  }

  try {
    // ── Step 1: Verify campaign exists ──
    const { data: campaign, error: campaignError } = await supabase
      .from("campaign")
      .select("id, client_id, status, program_id, hours_bought, start_at, end_at")
      .eq("id", campaign_id)
      .single();

    if (campaignError || !campaign) {
      return res.status(404).json({ error: `Campaign ${campaign_id} not found` });
    }

    if (campaign.client_id) {
      return res.status(409).json({
        error: "Campaign is already linked to a client",
        client_id: campaign.client_id,
      });
    }

    // ── Step 2: Check for duplicate username / email ──
    if (client_type === "company") {
      const { data: existing } = await supabase
        .from("client")
        .select("id")
        .eq("username", username.trim().toLowerCase())
        .maybeSingle();
      if (existing) {
        return res.status(409).json({ error: `Username '${username}' is already taken` });
      }
    }

    if (client_type === "agency") {
      const { data: existing } = await supabase
        .from("client")
        .select("id")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();
      if (existing) {
        return res.status(409).json({ error: `An account with email '${email}' already exists` });
      }
    }

    // ── Step 3: Create Supabase auth user ──
    let authUser;
    let authEmail;

    if (client_type === "company") {
      authEmail = usernameToEmail(username.trim());
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        password,
        email_confirm: true, // skip confirmation email for company accounts
      });
      if (error) {
        console.error("❌ Failed to create Supabase user:", error);
        return res.status(500).json({ error: "Failed to create auth user", details: error.message });
      }
      authUser = data.user;
    } else {
      // Agency — create user and send password reset so they set their own password
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        email_confirm: true,
        // No password — they'll use the invite/reset link to set one
      });
      if (error) {
        console.error("❌ Failed to create Supabase user:", error);
        return res.status(500).json({ error: "Failed to create auth user", details: error.message });
      }
      authUser = data.user;
      authEmail = email.trim().toLowerCase();

      // Send password reset email so they can set their own password
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: authEmail,
      });
    }

    // ── Step 4: Create client row ──
    const clientPayload = {
      name: name.trim(),
      user_id: authUser.id,
      email: authEmail,
      email_verified: client_type === "company", // company accounts are pre-verified
      client_type,
      role: "user",
      permissions: {},
      account_status: "active",
      created_by: req.user.id,
      updated_at: new Date().toISOString(),
    };

    if (client_type === "company") {
      clientPayload.username = username.trim().toLowerCase();
    }

    const { data: clientRow, error: clientError } = await supabase
      .from("client")
      .insert(clientPayload)
      .select()
      .single();

    if (clientError) {
      // Roll back: delete the auth user we just created
      await supabaseAdmin.auth.admin.deleteUser(authUser.id);
      console.error("❌ Failed to create client row:", clientError);
      return res.status(500).json({ error: "Failed to create client record", details: clientError.message });
    }

    // ── Step 5: Link client to campaign ──
    const { error: linkError } = await supabase
      .from("campaign")
      .update({ client_id: clientRow.id })
      .eq("id", campaign_id);

    if (linkError) {
      console.error("❌ Failed to link campaign:", linkError);
      // Non-fatal — client exists, can be linked manually
    }

    console.log(`✅ ${client_type} client '${name}' created and linked to campaign ${campaign_id}`);

    return res.status(201).json({
      success: true,
      client: {
        id: clientRow.id,
        name: clientRow.name,
        client_type: clientRow.client_type,
        username: clientRow.username || null,
        email: client_type === "agency" ? authEmail : undefined,
        account_status: clientRow.account_status,
      },
      campaign: {
        id: campaign.id,
        status: campaign.status,
        hours_bought: campaign.hours_bought,
        start_at: campaign.start_at,
        end_at: campaign.end_at,
      },
      // For company accounts, return the login credentials the admin just set
      login: client_type === "company"
        ? { username: username.trim().toLowerCase(), note: "Share these credentials with the client" }
        : { note: "Password reset email sent to " + authEmail },
    });
  } catch (err) {
    console.error("❌ Unexpected error in client creation:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * GET /admin/clients
 * List all clients with their linked campaign count.
 */
router.get("/", async (req, res) => {
  try {
    const { client_type } = req.query;

    let query = supabase
      .from("client")
      .select("id, name, email, username, client_type, account_status, role, created_at")
      .order("created_at", { ascending: false });

    if (client_type) query = query.eq("client_type", client_type);

    const { data: clients, error } = await query;
    if (error) throw new Error(error.message);

    // Attach campaign counts
    const clientIds = (clients || []).map((c) => c.id);
    const { data: campaigns } = await supabase
      .from("campaign")
      .select("client_id, id, status")
      .in("client_id", clientIds);

    const campaignsByClient = {};
    for (const c of campaigns || []) {
      if (!campaignsByClient[c.client_id]) campaignsByClient[c.client_id] = [];
      campaignsByClient[c.client_id].push({ id: c.id, status: c.status });
    }

    const result = (clients || []).map((c) => ({
      ...c,
      campaigns: campaignsByClient[c.id] || [],
      campaign_count: (campaignsByClient[c.id] || []).length,
    }));

    return res.json({ success: true, count: result.length, clients: result });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * PATCH /admin/clients/:id
 * Update a client's name, status, or password (company only).
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, account_status, password } = req.body;

    const { data: clientRow, error: fetchError } = await supabase
      .from("client")
      .select("id, user_id, client_type, name, account_status")
      .eq("id", id)
      .single();

    if (fetchError || !clientRow) {
      return res.status(404).json({ error: "Client not found" });
    }

    // Update password via admin API (company accounts only)
    if (password) {
      if (clientRow.client_type !== "company") {
        return res.status(400).json({ error: "Password can only be reset for company accounts" });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(
        clientRow.user_id,
        { password }
      );
      if (pwError) {
        return res.status(500).json({ error: "Failed to update password", details: pwError.message });
      }
    }

    const updates = { updated_at: new Date().toISOString() };
    if (name?.trim()) updates.name = name.trim();
    if (account_status) {
      const valid = ["active", "suspended", "deleted"];
      if (!valid.includes(account_status)) {
        return res.status(400).json({ error: `account_status must be one of: ${valid.join(", ")}` });
      }
      updates.account_status = account_status;
    }

    const { data: updated, error: updateError } = await supabase
      .from("client")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateError) throw new Error(updateError.message);

    return res.json({ success: true, client: updated });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

module.exports = router;
