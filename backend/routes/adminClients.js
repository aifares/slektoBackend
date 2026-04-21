const express = require("express");
const router = express.Router();
const multer = require("multer");
const { supabase } = require("../config/supabase");
const { supabaseAdmin, usernameToEmail } = require("../config/supabaseAdmin");
const { uploadImagesToColorLight, createProgram } = require("../services/colorLight");
const { checkBagAvailability, computeScheduleForProgram } = require("../services/playlistSchedule");
const { parseCampaignPayload } = require("../services/campaignPlaylists");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 40 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/bmp", "image/webp"];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Invalid file type: ${file.mimetype}`));
  },
});

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

/**
 * POST /admin/clients/onboard
 *
 * All-in-one: upload media to ColorLight, create campaign (rotation or split),
 * create company client account.
 * Content-Type: multipart/form-data
 *
 * Common fields:
 *   company_name  (string, required)
 *   username      (string, required)
 *   password      (string, required, min 8 chars)
 *   start_at      (ISO 8601, required)
 *   end_at        (ISO 8601, required)
 *   mode          ("rotation" | "split"; default "rotation")
 *
 * Rotation mode (default, legacy):
 *   hours_bought, bags_bought, images[]
 *
 * Split mode:
 *   playlists (JSON array: [{ label, bags, hours, image_count }, ...])
 *   images[]  (consumed in order)
 */
router.post("/onboard", upload.array("images", 40), async (req, res) => {
  try {
    const { company_name, username, password, start_at, end_at } = req.body;

    // ── Validate common fields ──
    const errors = [];
    if (!company_name?.trim()) errors.push("company_name is required");
    if (!username?.trim()) errors.push("username is required");
    if (!password || password.length < 8) errors.push("password must be at least 8 characters");
    if (!/^[a-zA-Z0-9_]+$/.test((username || "").trim())) errors.push("username may only contain letters, numbers, and underscores");
    if (!start_at) errors.push("start_at is required");
    if (!end_at) errors.push("end_at is required");
    if (errors.length > 0) return res.status(400).json({ success: false, error: "Validation failed", details: errors });

    const startAt = new Date(start_at);
    const endAt = new Date(end_at);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      return res.status(400).json({ success: false, error: "Invalid date format. Use ISO 8601" });
    }
    if (startAt >= endAt) {
      return res.status(400).json({ success: false, error: "start_at must be before end_at" });
    }

    // ── Parse mode + playlists ──
    let payload;
    try {
      payload = parseCampaignPayload(req.body, req.files);
    } catch (err) {
      return res.status(400).json({ success: false, error: "Validation failed", details: [err.message] });
    }

    const totalBags = payload.playlists.reduce((sum, p) => sum + p.bags, 0);
    const totalHours = payload.playlists.reduce((sum, p) => sum + p.hours, 0);
    const cleanUsername = username.trim().toLowerCase();

    // ── Check username uniqueness ──
    const { data: existingUser } = await supabase
      .from("client")
      .select("id")
      .eq("username", cleanUsername)
      .maybeSingle();
    if (existingUser) {
      return res.status(409).json({ success: false, error: `Username '${cleanUsername}' is already taken` });
    }

    // ── Check bag availability ──
    const availability = await checkBagAvailability(startAt.toISOString(), endAt.toISOString());
    if (totalBags > availability.available) {
      return res.status(409).json({
        success: false,
        error: "INSUFFICIENT_BAGS",
        message: `Only ${availability.available} bags available. Requested: ${totalBags}.`,
        available_bags: availability.available,
        peak_used: availability.peakUsed,
        conflict_date: availability.conflictDate,
      });
    }

    // ── For each playlist: upload images + create ColorLight program ──
    // client_id is patched in after the client row is created below.
    const createdPlaylists = []; // { program_id, program_name, label, bags, hours, fileRecordIds, files_uploaded }
    const allInsertedFileIds = [];

    for (let i = 0; i < payload.playlists.length; i++) {
      const p = payload.playlists[i];
      const playlistSuffix =
        payload.mode === "split" ? ` ${p.label || `Playlist ${i + 1}`}` : "";
      const programName = `${company_name.trim()} - ${startAt.toISOString().split("T")[0]}${playlistSuffix}`;

      console.log(`📤 [${programName}] Uploading ${p.files.length} images to ColorLight...`);
      let uploadedImages;
      try {
        uploadedImages = await uploadImagesToColorLight(p.files);
      } catch (uploadError) {
        return res.status(502).json({ success: false, error: "Failed to upload images to display network", details: uploadError.message });
      }

      console.log(`📋 [${programName}] Creating program...`);
      let programResponse;
      try {
        programResponse = await createProgram(programName, uploadedImages);
      } catch (programError) {
        return res.status(502).json({ success: false, error: "Failed to create playlist on display network", details: programError.message });
      }
      const programId = programResponse.id;

      // programs row
      const firstImage = uploadedImages[0]?.data || uploadedImages[0];
      const thumbnailUrl =
        firstImage?.media_details?.sizes?.thumbnail?.source_url ||
        firstImage?.source_url ||
        firstImage?.guid?.rendered ||
        null;

      await supabase.from("programs").upsert(
        { id: programId, name: programName, thumbnail_url: thumbnailUrl, status: "active", created: new Date().toISOString(), modified: new Date().toISOString() },
        { onConflict: "id" }
      );

      // files rows (client_id null; patched later)
      const fileRecords = uploadedImages.map((img) => {
        const data = img.data || img;
        return {
          program_id: programId,
          client_id: null,
          media_id: data.id,
          name: data.title?.rendered || data.name || data.slug || "unknown",
          source_url: data.source_url || data.guid?.rendered,
          mime_type: data.mime_type || null,
          file_size_bytes: data.attachment_filesize || null,
          media_width: data.media_details?.width || null,
          media_height: data.media_details?.height || null,
          custom_tags: [`${company_name.trim()}`],
          title: company_name.trim(),
          type: data.file_type || data.mime_type?.split("/")[1] || "image",
          last_synced_at: new Date().toISOString(),
        };
      });

      const { data: insertedFiles } = await supabase.from("files").insert(fileRecords).select("id");
      if (insertedFiles) {
        for (const f of insertedFiles) allInsertedFileIds.push(f.id);
      }

      createdPlaylists.push({
        program_id: programId,
        program_name: programName,
        label: p.label,
        bags: p.bags,
        hours: p.hours,
        files_uploaded: uploadedImages.length,
      });
    }

    // ── Create campaign (rollups point at first playlist) ──
    const { data: campaign, error: campaignError } = await supabase
      .from("campaign")
      .insert({
        program_id: createdPlaylists[0].program_id,
        hours_bought: totalHours,
        bags_bought: totalBags,
        mode: payload.mode,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: "planned",
      })
      .select()
      .single();
    if (campaignError) throw new Error(`Failed to create campaign: ${campaignError.message}`);

    // ── Insert campaign_playlists rows ──
    const playlistRows = createdPlaylists.map((p) => ({
      campaign_id: campaign.id,
      program_id: p.program_id,
      label: p.label,
      bags_assigned: p.bags,
      hours_bought: p.hours,
    }));
    const { error: playlistsError } = await supabase.from("campaign_playlists").insert(playlistRows);
    if (playlistsError) throw new Error(`Failed to insert campaign_playlists: ${playlistsError.message}`);

    // ── Create Supabase auth user ──
    const authEmail = usernameToEmail(cleanUsername);
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
    });
    if (authError) {
      // Roll back campaign (cascades campaign_playlists)
      await supabase.from("campaign").delete().eq("id", campaign.id);
      return res.status(500).json({ success: false, error: "Failed to create auth user", details: authError.message });
    }
    const authUser = authData.user;

    // ── Create client row ──
    const { data: clientRow, error: clientError } = await supabase
      .from("client")
      .insert({
        name: company_name.trim(),
        user_id: authUser.id,
        email: authEmail,
        email_verified: true,
        client_type: "company",
        username: cleanUsername,
        role: "user",
        permissions: {},
        account_status: "active",
        created_by: req.user.id,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (clientError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.id);
      await supabase.from("campaign").delete().eq("id", campaign.id);
      return res.status(500).json({ success: false, error: "Failed to create client record", details: clientError.message });
    }

    // ── Link client to campaign ──
    await supabase.from("campaign").update({ client_id: clientRow.id }).eq("id", campaign.id);

    // ── Patch all inserted files with the new client_id ──
    if (allInsertedFileIds.length > 0) {
      await supabase.from("files").update({ client_id: clientRow.id }).in("id", allInsertedFileIds);
    }

    // ── Compute playlist schedule per program (non-fatal) ──
    for (const p of createdPlaylists) {
      try { await computeScheduleForProgram(p.program_id); } catch (_) {}
    }

    console.log(`✅ Onboarded company '${company_name.trim()}' — client ${clientRow.id}, campaign ${campaign.id} (mode=${payload.mode})`);

    return res.status(201).json({
      success: true,
      message: "Client onboarded successfully",
      client: {
        id: clientRow.id,
        name: clientRow.name,
        client_type: "company",
        username: cleanUsername,
        account_status: "active",
      },
      campaign: {
        id: campaign.id,
        mode: payload.mode,
        program_id: createdPlaylists[0].program_id,
        program_name: createdPlaylists[0].program_name,
        hours_bought: totalHours,
        bags_bought: totalBags,
        start_at: campaign.start_at,
        end_at: campaign.end_at,
        status: campaign.status,
        files_uploaded: createdPlaylists.reduce((sum, p) => sum + p.files_uploaded, 0),
      },
      playlists: createdPlaylists.map((p) => ({
        program_id: p.program_id,
        program_name: p.program_name,
        label: p.label,
        bags_assigned: p.bags,
        hours_bought: p.hours,
        files_uploaded: p.files_uploaded,
      })),
      login: {
        username: cleanUsername,
        note: "Share these credentials with the client. They can log in at POST /auth/client/login",
      },
    });
  } catch (err) {
    console.error("❌ Unexpected error in client onboarding:", err);
    return res.status(500).json({ success: false, error: "Internal server error", details: err.message });
  }
});

// Multer error handler for onboard route
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ success: false, error: "File too large. Maximum 10MB per file." });
    if (err.code === "LIMIT_FILE_COUNT") return res.status(400).json({ success: false, error: "Too many files. Maximum 40 images." });
    return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
  }
  if (err.message?.includes("Invalid file type")) return res.status(400).json({ success: false, error: err.message });
  next(err);
});

module.exports = router;
