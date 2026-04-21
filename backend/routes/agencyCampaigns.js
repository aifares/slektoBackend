const express = require("express");
const router = express.Router();
const multer = require("multer");
const { supabase } = require("../config/supabase");
const {
  uploadImagesToColorLight,
  createProgram,
} = require("../services/colorLight");
const {
  checkBagAvailability,
  computeScheduleForProgram,
} = require("../services/playlistSchedule");
const {
  buildCampaignPlaybackMetrics,
} = require("../services/campaignMetrics");
const {
  getCampaignPlaylists,
  getPlaylistsByCampaignIds,
  parseCampaignPayload,
} = require("../services/campaignPlaylists");

// Configure multer for memory storage (buffers, not disk files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 40, // max 40 images across all playlists
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/bmp",
      "image/webp",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file type: ${file.mimetype}. Allowed: ${allowedTypes.join(", ")}`,
        ),
      );
    }
  },
});

/**
 * POST /api/v1/campaigns
 * Create a campaign (rotation or split mode) on behalf of an agency.
 *
 * Auth: Bearer <supabase_jwt>
 * Content-Type: multipart/form-data
 *
 * Rotation mode (default, backwards compatible):
 *   company_name, start_at, end_at, hours_bought, bags_bought, images[]
 *
 * Split mode (mode=split):
 *   company_name, start_at, end_at, playlists (JSON), images[]
 *   where playlists = [{ label, bags, hours, image_count }, ...] (>= 2 entries)
 *   and images[] are consumed in order (first image_count -> playlist 0, etc.)
 */
router.post("/campaigns", upload.array("images", 40), async (req, res) => {
  try {
    const client = req.client;

    // ── Step 0: Permission check ──
    if (!client.permissions?.can_create_campaigns) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to create campaigns",
      });
    }

    // ── Step 1: Validate top-level fields ──
    const { company_name, start_at, end_at } = req.body;

    const errors = [];
    if (!company_name || !company_name.trim()) {
      errors.push("company_name is required");
    }
    if (!start_at) errors.push("start_at is required");
    if (!end_at) errors.push("end_at is required");

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: errors,
      });
    }

    const startAt = new Date(start_at);
    const endAt = new Date(end_at);

    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use ISO 8601 (e.g. 2026-03-01T00:00:00Z)",
      });
    }

    if (startAt >= endAt) {
      return res.status(400).json({
        success: false,
        error: "start_at must be before end_at",
      });
    }

    // ── Step 2: Parse mode + playlists ──
    let payload;
    try {
      payload = parseCampaignPayload(req.body, req.files);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: [err.message],
      });
    }

    const totalBags = payload.playlists.reduce((sum, p) => sum + p.bags, 0);
    const totalHours = payload.playlists.reduce((sum, p) => sum + p.hours, 0);

    // ── Step 3: Check bag availability (sum across playlists) ──
    console.log(
      `🔍 Checking bag availability for ${totalBags} bags (${startAt.toISOString()} - ${endAt.toISOString()})...`,
    );

    const availability = await checkBagAvailability(
      startAt.toISOString(),
      endAt.toISOString(),
    );

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

    // ── Step 4: Upsert company name ──
    if (company_name.trim() !== client.name) {
      const { error: updateError } = await supabase
        .from("client")
        .update({ name: company_name.trim() })
        .eq("id", client.id);

      if (updateError) {
        console.warn(
          `⚠️  Failed to update client name: ${updateError.message}`,
        );
      } else {
        console.log(
          `✅ Updated client name: "${client.name}" → "${company_name.trim()}"`,
        );
      }
    }

    // ── Step 5: For each playlist: upload images + create ColorLight program ──
    const createdPlaylists = []; // { program_id, program_name, label, bags, hours, files_uploaded }

    for (let i = 0; i < payload.playlists.length; i++) {
      const p = payload.playlists[i];
      const playlistSuffix =
        payload.mode === "split"
          ? ` [${p.label || `Playlist ${i + 1}`}]`
          : "";
      const programName = `${company_name.trim()} - ${startAt.toISOString().split("T")[0]}${playlistSuffix}`;

      console.log(
        `📤 [${programName}] Uploading ${p.files.length} images to ColorLight...`,
      );
      let uploadedImages;
      try {
        uploadedImages = await uploadImagesToColorLight(p.files);
      } catch (uploadError) {
        console.error("❌ ColorLight upload failed:", uploadError.message);
        return res.status(502).json({
          success: false,
          error: "Failed to upload images to display network",
          details: uploadError.message,
        });
      }

      console.log(`📋 [${programName}] Creating program...`);
      let programResponse;
      try {
        programResponse = await createProgram(programName, uploadedImages);
      } catch (programError) {
        console.error("❌ Program creation failed:", programError.message);
        return res.status(502).json({
          success: false,
          error: "Failed to create playlist on display network",
          details: programError.message,
        });
      }

      const programId = programResponse.id;

      // Program DB row
      const firstImage = uploadedImages[0]?.data || uploadedImages[0];
      const thumbnailUrl =
        firstImage?.media_details?.sizes?.thumbnail?.source_url ||
        firstImage?.source_url ||
        firstImage?.guid?.rendered ||
        null;

      const { error: programDbError } = await supabase
        .from("programs")
        .upsert(
          {
            id: programId,
            name: programName,
            thumbnail_url: thumbnailUrl,
            status: "active",
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          },
          { onConflict: "id" },
        );

      if (programDbError) {
        console.warn(
          `⚠️  Failed to insert program into DB: ${programDbError.message}`,
        );
      }

      // Files DB rows
      const fileRecords = uploadedImages.map((img) => {
        const data = img.data || img;
        return {
          program_id: programId,
          client_id: client.id,
          media_id: data.id,
          name: data.title?.rendered || data.name || data.slug || "unknown",
          source_url: data.source_url || data.guid?.rendered,
          mime_type: data.mime_type || null,
          file_size_bytes: data.attachment_filesize || null,
          media_width: data.media_details?.width || null,
          media_height: data.media_details?.height || null,
          custom_tags: [`${company_name.trim()}_${client.id}`],
          title: company_name.trim(),
          type: data.file_type || data.mime_type?.split("/")[1] || "image",
          last_synced_at: new Date().toISOString(),
        };
      });

      const { error: filesError } = await supabase
        .from("files")
        .insert(fileRecords);

      if (filesError) {
        console.error(`❌ Failed to insert files: ${filesError.message}`);
        // Non-fatal: campaign can still be created
      } else {
        console.log(`✅ Inserted ${fileRecords.length} file records`);
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

    // ── Step 6: Create campaign row (rollups point at first playlist) ──
    console.log(`🎯 Creating campaign...`);

    const { data: campaign, error: campaignError } = await supabase
      .from("campaign")
      .insert({
        client_id: client.id,
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

    if (campaignError) {
      throw new Error(`Failed to create campaign: ${campaignError.message}`);
    }

    console.log(`✅ Campaign ${campaign.id} created (mode=${payload.mode})`);

    // ── Step 7: Insert campaign_playlists rows ──
    const playlistRows = createdPlaylists.map((p) => ({
      campaign_id: campaign.id,
      program_id: p.program_id,
      label: p.label,
      bags_assigned: p.bags,
      hours_bought: p.hours,
    }));

    const { error: playlistsError } = await supabase
      .from("campaign_playlists")
      .insert(playlistRows);

    if (playlistsError) {
      throw new Error(
        `Failed to insert campaign_playlists: ${playlistsError.message}`,
      );
    }

    // ── Step 8: Compute playlist schedule for each program ──
    for (const p of createdPlaylists) {
      try {
        await computeScheduleForProgram(p.program_id);
      } catch (scheduleError) {
        console.warn(
          `⚠️  Failed to compute schedule for program ${p.program_id}: ${scheduleError.message}`,
        );
        // Non-fatal: schedule can be recomputed later
      }
    }

    // ── Response ──
    const updatedAvailability = await checkBagAvailability(
      startAt.toISOString(),
      endAt.toISOString(),
    );

    return res.status(201).json({
      success: true,
      message: "Campaign created successfully",
      campaign: {
        id: campaign.id,
        client_id: campaign.client_id,
        company_name: company_name.trim(),
        mode: payload.mode,
        // rollup fields for backwards compatibility
        program_id: createdPlaylists[0].program_id,
        program_name: createdPlaylists[0].program_name,
        hours_bought: totalHours,
        bags_bought: totalBags,
        start_at: campaign.start_at,
        end_at: campaign.end_at,
        status: campaign.status,
        files_uploaded: createdPlaylists.reduce(
          (sum, p) => sum + p.files_uploaded,
          0,
        ),
        available_bags_after: updatedAvailability.available,
      },
      playlists: createdPlaylists.map((p) => ({
        program_id: p.program_id,
        program_name: p.program_name,
        label: p.label,
        bags_assigned: p.bags,
        hours_bought: p.hours,
        files_uploaded: p.files_uploaded,
      })),
    });
  } catch (error) {
    console.error("❌ Error creating campaign:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to create campaign",
      details: error.message,
    });
  }
});

/**
 * GET /api/v1/campaigns
 * List all campaigns created by the authenticated agency.
 *
 * Auth: Bearer token (Supabase JWT)
 *
 * Query params:
 *   status  (optional) — filter by status: planned, active, completed, paused, cancelled
 */
router.get("/campaigns", async (req, res) => {
  try {
    const client = req.client;
    const { status } = req.query;

    let query = supabase
      .from("campaign")
      .select(
        "id, program_id, mode, status, start_at, end_at, hours_bought, bags_bought, completed_at, created_at",
      )
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data: campaigns, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch campaigns",
        details: error.message,
      });
    }

    if (!campaigns || campaigns.length === 0) {
      return res.json({ success: true, campaigns: [], count: 0 });
    }

    // Fetch per-campaign playlists in one shot
    const playlistsByCampaign = await getPlaylistsByCampaignIds(
      campaigns.map((c) => c.id),
    );

    // Collect all program_ids across rollup + children for name lookup
    const programIds = [
      ...new Set(
        campaigns
          .flatMap((c) => [
            c.program_id,
            ...(playlistsByCampaign[c.id] || []).map((p) => p.program_id),
          ])
          .filter(Boolean),
      ),
    ];
    const { data: programs } = await supabase
      .from("programs")
      .select("id, name")
      .in("id", programIds);

    const programNameById = Object.fromEntries(
      (programs || []).map((p) => [p.id, p.name]),
    );

    const result = campaigns.map((c) => {
      const programName = programNameById[c.program_id] || null;
      const company_name = programName
        ? programName.replace(/\s*-\s*\d{4}-\d{2}-\d{2}(\s*\[.+\])?$/, "").trim()
        : null;

      const children = playlistsByCampaign[c.id] || [];

      return {
        id: c.id,
        company_name,
        mode: c.mode || "rotation",
        program_id: c.program_id,
        status: c.status,
        start_at: c.start_at,
        end_at: c.end_at,
        hours_bought: c.hours_bought,
        bags_bought: c.bags_bought,
        playlist_count: children.length,
        completed_at: c.completed_at || null,
        created_at: c.created_at,
      };
    });

    return res.json({
      success: true,
      campaigns: result,
      count: result.length,
    });
  } catch (error) {
    console.error("❌ Error listing agency campaigns:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to list campaigns",
      details: error.message,
    });
  }
});

/**
 * GET /api/v1/campaigns/:id
 * Get analytics for a specific campaign, including per-playlist breakdown.
 * The campaign must belong to the authenticated agency.
 *
 * Auth: Bearer token (Supabase JWT)
 */
router.get("/campaigns/:id", async (req, res) => {
  try {
    const client = req.client;
    const campaignId = parseInt(req.params.id, 10);

    if (isNaN(campaignId)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid campaign ID" });
    }

    // Fetch campaign and enforce ownership
    const { data: campaign, error: campaignError } = await supabase
      .from("campaign")
      .select("*")
      .eq("id", campaignId)
      .eq("client_id", client.id)
      .single();

    if (campaignError || !campaign) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found",
      });
    }

    const playlists = await getCampaignPlaylists(campaignId);
    const programIds = playlists.map((p) => p.program_id);

    // Program name lookup
    const { data: programs } = await supabase
      .from("programs")
      .select("id, name")
      .in("id", programIds.length ? programIds : [-1]);
    const programNameById = Object.fromEntries(
      (programs || []).map((p) => [p.id, p.name]),
    );

    const rollupProgramName = programNameById[campaign.program_id] || null;
    const company_name = rollupProgramName
      ? rollupProgramName
          .replace(/\s*-\s*\d{4}-\d{2}-\d{2}(\s*\[.+\])?$/, "")
          .trim()
      : null;

    // Terminals that have played any of this campaign's programs
    const { data: sessions } = await supabase
      .from("playing")
      .select("terminal_id")
      .in("program_id", programIds.length ? programIds : [-1]);
    const terminalIds = sessions
      ? [...new Set(sessions.map((s) => s.terminal_id))]
      : [];

    // Build per-playlist metrics
    const perPlaylist = [];
    let rollupMinutesPlayed = 0;
    let rollupHoursBought = 0;

    for (const p of playlists) {
      const playlistCampaignShape = {
        ...campaign,
        id: campaign.id,
        program_id: p.program_id,
        hours_bought: p.hours_bought,
        completed_at: p.completed_at || campaign.completed_at || null,
      };

      const metrics = await buildCampaignPlaybackMetrics(
        [playlistCampaignShape],
        [p.program_id],
        terminalIds.length > 0 ? terminalIds : null,
        client.id,
      );

      const m =
        metrics._byCampaign?.[campaign.id] || metrics[p.program_id] || {};

      // Count files for this playlist
      const { data: files } = await supabase
        .from("files")
        .select("id, removed_at")
        .eq("program_id", p.program_id)
        .eq("client_id", client.id);
      const activeFiles = (files || []).filter((f) => f.removed_at === null);
      const removedFiles = (files || []).filter((f) => f.removed_at !== null);

      perPlaylist.push({
        id: p.id,
        program_id: p.program_id,
        program_name: programNameById[p.program_id] || null,
        label: p.label,
        bags_assigned: p.bags_assigned,
        hours_bought: p.hours_bought,
        hours_played: m.hours_played_since_campaign_start || 0,
        minutes_played: m.minutes_played_since_campaign_start || 0,
        completion_percent: m.campaign_completion_percent || 0,
        share_of_voice_percent: m.share_of_voice_percent || null,
        media_urls: m.media_urls || [],
        completed_at: p.completed_at || null,
        files: {
          active: activeFiles.length,
          removed: removedFiles.length,
          total: (files || []).length,
        },
      });

      rollupMinutesPlayed += m.minutes_played_since_campaign_start || 0;
      rollupHoursBought += Number(p.hours_bought || 0);
    }

    const rollupCompletionPercent =
      rollupHoursBought > 0
        ? Math.min(
            100,
            Math.round(
              (rollupMinutesPlayed / (rollupHoursBought * 60)) * 100,
            ),
          )
        : 0;

    return res.json({
      success: true,
      campaign: {
        id: campaign.id,
        company_name,
        mode: campaign.mode || "rotation",
        // rollup fields
        program_id: campaign.program_id,
        program_name: rollupProgramName,
        status: campaign.status,
        start_at: campaign.start_at,
        end_at: campaign.end_at,
        completed_at: campaign.completed_at || null,
        hours_bought: campaign.hours_bought,
        bags_bought: campaign.bags_bought,
      },
      analytics: {
        hours_played: Number((rollupMinutesPlayed / 60).toFixed(2)),
        minutes_played: rollupMinutesPlayed,
        hours_bought: rollupHoursBought,
        completion_percent: rollupCompletionPercent,
      },
      playlists: perPlaylist,
    });
  } catch (error) {
    console.error("❌ Error fetching campaign analytics:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch campaign analytics",
      details: error.message,
    });
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        error: "File too large. Maximum size is 10MB per file.",
      });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        error: "Too many files. Maximum is 40 images.",
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  if (err.message && err.message.includes("Invalid file type")) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  next(err);
});

module.exports = router;
