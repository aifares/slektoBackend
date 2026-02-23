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
const { fetchHistoricalTerminals } = require("../services/historicalTerminals");
const { buildZoneCoverageMetrics } = require("../services/zoneCoverage");

// Configure multer for memory storage (buffers, not disk files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 20, // max 20 images
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
 * Create a new campaign (third-party agency endpoint)
 *
 * Auth: Bearer <supabase_jwt> (resolved via authMiddleware)
 * Content-Type: multipart/form-data
 *
 * Fields:
 *   company_name  (string, required)
 *   start_at      (ISO 8601, required)
 *   end_at        (ISO 8601, required)
 *   hours_bought  (number, required)
 *   bags_bought   (integer, required)
 *   images        (file[], required, 1-20 files)
 */
router.post("/campaigns", upload.array("images", 20), async (req, res) => {
  try {
    const client = req.client;

    // ── Step 0: Permission check ──
    if (!client.permissions?.can_create_campaigns) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to create campaigns",
      });
    }

    // ── Step 1: Validate input ──
    const { company_name, start_at, end_at, hours_bought, bags_bought } =
      req.body;

    const errors = [];
    if (!company_name || !company_name.trim()) {
      errors.push("company_name is required");
    }
    if (!start_at) errors.push("start_at is required");
    if (!end_at) errors.push("end_at is required");
    if (!hours_bought || Number(hours_bought) <= 0) {
      errors.push("hours_bought must be a positive number");
    }
    if (!bags_bought || Number(bags_bought) <= 0) {
      errors.push("bags_bought must be a positive integer");
    }
    if (!req.files || req.files.length === 0) {
      errors.push("At least one image is required");
    }

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

    const hoursBought = Number(hours_bought);
    const bagsBought = parseInt(bags_bought, 10);

    // ── Step 2: Check bag availability ──
    console.log(
      `🔍 Checking bag availability for ${bagsBought} bags (${startAt.toISOString()} - ${endAt.toISOString()})...`,
    );

    const availability = await checkBagAvailability(
      startAt.toISOString(),
      endAt.toISOString(),
    );

    if (bagsBought > availability.available) {
      return res.status(409).json({
        success: false,
        error: "INSUFFICIENT_BAGS",
        message: `Only ${availability.available} bags available. Requested: ${bagsBought}.`,
        available_bags: availability.available,
        peak_used: availability.peakUsed,
        conflict_date: availability.conflictDate,
      });
    }

    // ── Step 3: Upsert company name ──
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

    // ── Step 4: Upload images to ColorLight ──
    console.log(`📤 Uploading ${req.files.length} images to ColorLight...`);

    const filesToUpload = req.files.map((f) => ({
      buffer: f.buffer,
      filename: f.originalname,
      mimetype: f.mimetype,
    }));

    let uploadedImages;
    try {
      uploadedImages = await uploadImagesToColorLight(filesToUpload);
    } catch (uploadError) {
      console.error("❌ ColorLight upload failed:", uploadError.message);
      return res.status(502).json({
        success: false,
        error: "Failed to upload images to display network",
        details: uploadError.message,
      });
    }

    // ── Step 5: Create program (playlist) on ColorLight ──
    const programName = `${company_name.trim()} - ${startAt.toISOString().split("T")[0]}`;
    console.log(`📋 Creating program: ${programName}...`);

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

    // ── Step 6: Insert program into programs table ──
    // Use the first uploaded image's thumbnail as the program thumbnail
    const firstImage = uploadedImages[0]?.data || uploadedImages[0];
    const thumbnailUrl =
      firstImage?.media_details?.sizes?.thumbnail?.source_url ||
      firstImage?.source_url ||
      firstImage?.guid?.rendered ||
      null;

    const { error: programDbError } = await supabase.from("programs").upsert(
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

    // ── Step 7: Insert file records ──
    console.log(`💾 Inserting ${uploadedImages.length} file records...`);

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

    const { data: insertedFiles, error: filesError } = await supabase
      .from("files")
      .insert(fileRecords)
      .select("id, name, media_id");

    if (filesError) {
      console.error(`❌ Failed to insert files: ${filesError.message}`);
      // Non-fatal: campaign can still be created
    } else {
      console.log(`✅ Inserted ${insertedFiles.length} file records`);
    }

    // ── Step 8: Create campaign ──
    console.log(`🎯 Creating campaign...`);

    const { data: campaign, error: campaignError } = await supabase
      .from("campaign")
      .insert({
        client_id: client.id,
        program_id: programId,
        hours_bought: hoursBought,
        bags_bought: bagsBought,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: "planned",
      })
      .select()
      .single();

    if (campaignError) {
      throw new Error(`Failed to create campaign: ${campaignError.message}`);
    }

    console.log(`✅ Campaign ${campaign.id} created`);

    // ── Step 9: Compute playlist schedule ──
    try {
      await computeScheduleForProgram(programId);
    } catch (scheduleError) {
      console.warn(
        `⚠️  Failed to compute playlist schedule: ${scheduleError.message}`,
      );
      // Non-fatal: schedule can be recomputed later
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
        program_id: programId,
        program_name: programName,
        hours_bought: hoursBought,
        bags_bought: bagsBought,
        start_at: campaign.start_at,
        end_at: campaign.end_at,
        status: campaign.status,
        files_uploaded: uploadedImages.length,
        available_bags_after: updatedAvailability.available,
      },
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
      .select("id, program_id, status, start_at, end_at, hours_bought, bags_bought, completed_at, created_at")
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

    // Fetch program names so we can surface the company name per campaign
    const programIds = [...new Set(campaigns.map((c) => c.program_id))];
    const { data: programs } = await supabase
      .from("programs")
      .select("id, name")
      .in("id", programIds);

    const programNameById = Object.fromEntries(
      (programs || []).map((p) => [p.id, p.name])
    );

    const result = campaigns.map((c) => {
      const programName = programNameById[c.program_id] || null;
      // Program name format is "<company_name> - <date>", extract company name
      const company_name = programName
        ? programName.replace(/\s*-\s*\d{4}-\d{2}-\d{2}$/, "").trim()
        : null;

      return {
        id: c.id,
        company_name,
        program_id: c.program_id,
        status: c.status,
        start_at: c.start_at,
        end_at: c.end_at,
        hours_bought: c.hours_bought,
        bags_bought: c.bags_bought,
        completed_at: c.completed_at || null,
        created_at: c.created_at,
      };
    });

    return res.json({ success: true, campaigns: result, count: result.length });
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
 * Get full analytics for a specific campaign (same shape as GET /analytics).
 * The campaign must belong to the authenticated agency.
 *
 * Auth: Bearer token (Supabase JWT)
 */
router.get("/campaigns/:id", async (req, res) => {
  try {
    const client = req.client;
    const campaignId = parseInt(req.params.id, 10);
    const zoneLimit = Math.max(
      1,
      Math.min(50, parseInt(req.query.zoneLimit, 10) || 50)
    );

    if (isNaN(campaignId)) {
      return res.status(400).json({ success: false, error: "Invalid campaign ID" });
    }

    // Fetch campaign and enforce ownership
    const { data: campaign, error: campaignError } = await supabase
      .from("campaign")
      .select("*")
      .eq("id", campaignId)
      .eq("client_id", client.id) // agency can only see their own campaigns
      .single();

    if (campaignError || !campaign) {
      return res.status(404).json({
        success: false,
        error: "Campaign not found",
      });
    }

    const programId = campaign.program_id;
    const nowIso = new Date().toISOString();
    const isActive =
      campaign.start_at <= nowIso &&
      campaign.end_at >= nowIso &&
      campaign.status === "active" &&
      campaign.completed_at === null;
    const activeProgramIds = isActive ? [programId] : [];

    // Fetch playing sessions for this program (same fields as full analytics)
    const { data: allPlayingSessions, error: allPlayingError } = await supabase
      .from("playing")
      .select(
        "terminal_id, program_id, program_name, file_name, source, started_at, ended_at, status"
      )
      .eq("program_id", programId);

    if (allPlayingError) {
      return res.status(500).json({
        error: "Failed to fetch playing sessions",
        details: allPlayingError.message,
      });
    }

    const terminalIds = Array.from(
      new Set((allPlayingSessions || []).map((s) => s.terminal_id))
    );

    // Campaign playback metrics
    const campaignWithActive = { ...campaign, isActive };
    const playbackMetricsByProgram = await buildCampaignPlaybackMetrics(
      [campaignWithActive],
      [programId],
      terminalIds.length > 0 ? terminalIds : null,
      client.id
    );
    if (playbackMetricsByProgram[programId]) {
      playbackMetricsByProgram[programId].isActive = isActive;
    }

    // Historical terminals
    let allHistoricalTerminals = [];
    try {
      allHistoricalTerminals = await fetchHistoricalTerminals([programId]);
    } catch (err) {
      console.warn("Failed to fetch historical terminals:", err.message);
    }

    const terminalIdsForCoverage =
      terminalIds.length > 0
        ? terminalIds
        : Array.from(
            new Set((allHistoricalTerminals || []).map((t) => t.terminal_id))
          );

    // Currently playing rows
    const currentlyPlayingRows = (allPlayingSessions || []).filter(
      (p) => p.status === "current"
    );

    // Terminal metadata and status (only if we have terminals)
    let terminalsOut = [];
    let terminalsPlayingCount = 0;
    let offlineCount = 0;

    if (terminalIds.length > 0) {
      const { data: terminalRows, error: terminalsError } = await supabase
        .from("terminals")
        .select("terminalid, name, group_name, last_report_time, power_status")
        .in("terminalid", terminalIds);

      if (terminalsError) {
        return res.status(500).json({
          error: "Failed to fetch terminal metadata",
          details: terminalsError.message,
        });
      }

      const { data: terminalStatusRows, error: statusError } = await supabase.rpc(
        "get_latest_terminal_status",
        { p_terminal_ids: terminalIds }
      );
      const latestStatusByTerminal = {};
      if (!statusError && terminalStatusRows) {
        for (const row of terminalStatusRows) {
          latestStatusByTerminal[row.terminal_id] = row.status;
        }
      }

      const playingByTerminalId = Object.fromEntries(
        currentlyPlayingRows.map((p) => [p.terminal_id, p])
      );
      const currentlyPlayingTerminalIds = currentlyPlayingRows.map((p) => p.terminal_id);
      const terminalsForDisplay = (terminalRows || []).filter((t) =>
        currentlyPlayingTerminalIds.includes(t.terminalid)
      );

      terminalsOut = terminalsForDisplay.map((terminal) => {
        const playing = playingByTerminalId[terminal.terminalid] || null;
        const isOnline = latestStatusByTerminal[terminal.terminalid] === "online";
        return {
          terminalId: terminal.terminalid,
          name: terminal.name || null,
          group_name: terminal.group_name || null,
          last_report_time: terminal.last_report_time || null,
          power_status: terminal.power_status || null,
          isOnline,
          playing: playing
            ? {
                program_id: playing.program_id,
                program_name: playing.program_name,
                file_name: playing.file_name,
                source: playing.source,
                started_at: playing.started_at,
              }
            : null,
        };
      });

      terminalsPlayingCount = currentlyPlayingRows.length;
      offlineCount = (terminalRows || []).filter(
        (t) => t.power_status === "off"
      ).length;
    }

    // Zone coverage date range (campaign window)
    let zoneStartDateFinal = campaign.start_at;
    let zoneEndDateFinal = nowIso;
    const endAt = new Date(campaign.end_at);
    const now = new Date(nowIso);
    if (endAt < now) {
      zoneEndDateFinal = campaign.end_at;
    } else {
      zoneEndDateFinal = nowIso;
    }

    let zoneCoverage = {};
    if (terminalIdsForCoverage.length > 0) {
      try {
        zoneCoverage = await buildZoneCoverageMetrics(
          [programId],
          terminalIdsForCoverage,
          zoneStartDateFinal,
          zoneEndDateFinal,
          zoneLimit,
          client.id
        );
        for (const [pid, coverage] of Object.entries(zoneCoverage)) {
          coverage.isActive = isActive;
        }
      } catch (err) {
        console.warn("Failed to build zone coverage metrics:", err.message);
      }
    }

    const { _byCampaign, ...campaignMetricsForClient } = playbackMetricsByProgram;

    const response = {
      client: {
        id: client.id,
        name: client.name,
        activePrograms: activeProgramIds,
      },
      terminals: terminalsOut,
      summary: {
        total_terminals: terminalsOut.length,
        terminals_playing: terminalsPlayingCount,
        terminals_offline: offlineCount,
        historical_terminals_count: allHistoricalTerminals.length,
      },
      historical_terminals: allHistoricalTerminals,
      campaign_metrics: campaignMetricsForClient,
      zone_coverage: zoneCoverage,
    };

    return res.json(response);
  } catch (error) {
    console.error("❌ Error fetching campaign analytics:", error.message);
    return res.status(500).json({
      error: "Failed to build analytics data",
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
        error: "Too many files. Maximum is 20 images.",
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
