const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");
const { syncMediaFromColorLight } = require("../services/mediaSync");
const { monitorAndAutoComplete } = require("../services/campaignCompletion");
const {
  createShareOfVoiceSnapshot,
} = require("../services/shareOfVoiceSnapshots");
const {
  computeScheduleForProgram,
  checkBagAvailability,
} = require("../services/playlistSchedule");

/**
 * Admin Campaign Management Routes
 * All routes require authentication (bearer token)
 */

/**
 * POST /admin/campaigns/create
 * Create a new campaign
 *
 * Body:
 * {
 *   "client_id": 5,
 *   "program_id": 2620340,
 *   "hours_bought": 0.0833,  // 5 minutes
 *   "start_at": "2025-11-25T20:00:00Z",  // Optional, defaults to NOW
 *   "end_at": "2025-12-02T20:00:00Z",    // Optional, defaults to 1 year from start_at
 *   "status": "active"  // Optional, defaults to "active"
 * }
 *
 * Note: If end_at is not provided, it defaults to 1 year from start_at.
 *       Campaign completion is tracked via hours_bought and completed_at timestamp.
 */
router.post("/campaigns/create", async (req, res) => {
  try {
    const { client_id, program_id, hours_bought, start_at, end_at, status } =
      req.body;

    // Validation
    if (!client_id || !program_id || !hours_bought) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: client_id, program_id, hours_bought",
      });
    }

    // Set defaults
    // If start_at is provided, parse it; otherwise use now
    const startTime = start_at
      ? new Date(start_at).toISOString()
      : new Date().toISOString();

    // Calculate end_at: if not provided, default to 1 year in the future
    // This allows campaigns to run until hours_bought is reached (tracked via completed_at)
    let endTime;
    if (end_at) {
      // Use explicitly provided end_at
      endTime = new Date(end_at).toISOString();
    } else {
      // Default to 1 year from start - campaign completion is tracked by hours_bought and completed_at
      const startDate = new Date(startTime);
      const oneYearLater = new Date(startDate);
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
      endTime = oneYearLater.toISOString();
    }
    const campaignStatus = status || "active";

    // Validate that start_at <= end_at
    if (new Date(startTime) > new Date(endTime)) {
      return res.status(400).json({
        success: false,
        error: "start_at must be less than or equal to end_at",
        details: `start_at: ${startTime}, end_at: ${endTime}`,
      });
    }

    // Verify client exists
    const { data: client, error: clientError } = await supabase
      .from("client")
      .select("id, name")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return res.status(404).json({
        success: false,
        error: `Client ${client_id} not found`,
      });
    }

    // Verify program exists (check files table)
    const { data: programFiles, error: programError } = await supabase
      .from("files")
      .select("id")
      .eq("program_id", program_id)
      .is("removed_at", null)
      .limit(1);

    if (programError || !programFiles || programFiles.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Program ${program_id} not found or has no active files`,
      });
    }

    // Check bag availability if bags_bought is provided
    const bags_bought = req.body.bags_bought
      ? parseInt(req.body.bags_bought, 10)
      : null;
    if (bags_bought) {
      const availability = await checkBagAvailability(startTime, endTime);
      if (bags_bought > availability.available) {
        return res.status(409).json({
          success: false,
          error: `Only ${availability.available} bags available. Requested: ${bags_bought}.`,
          available_bags: availability.available,
        });
      }
    }

    // Create campaign
    const { data: campaign, error: createError } = await supabase
      .from("campaign")
      .insert({
        client_id,
        program_id,
        hours_bought,
        bags_bought,
        start_at: startTime,
        end_at: endTime,
        status: campaignStatus,
      })
      .select()
      .single();

    if (createError) {
      throw new Error(`Failed to create campaign: ${createError.message}`);
    }

    console.log(`✅ Campaign ${campaign.id} created for client ${client_id}`);

    // Compute playlist schedule for this program
    try {
      await computeScheduleForProgram(program_id);
    } catch (scheduleError) {
      console.warn(
        `⚠️  Failed to compute playlist schedule: ${scheduleError.message}`,
      );
    }

    return res.json({
      success: true,
      message: "Campaign created successfully",
      campaign: {
        id: campaign.id,
        client_id: campaign.client_id,
        client_name: client.name,
        program_id: campaign.program_id,
        hours_bought: campaign.hours_bought,
        bags_bought: campaign.bags_bought,
        minutes_bought: campaign.hours_bought * 60,
        start_at: campaign.start_at,
        end_at: campaign.end_at,
        completed_at: campaign.completed_at,
        status: campaign.status,
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
 * GET /admin/campaigns/status/:campaignId
 * Get detailed status of a campaign including completion percentage
 */
router.get("/campaigns/status/:campaignId", async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId);

    // Get campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from("campaign")
      .select("*")
      .eq("id", campaignId)
      .single();

    if (campaignError || !campaign) {
      return res.status(404).json({
        success: false,
        error: `Campaign ${campaignId} not found`,
      });
    }

    // Get client name
    const { data: client } = await supabase
      .from("client")
      .select("name")
      .eq("id", campaign.client_id)
      .single();

    // Get program name
    const { data: program } = await supabase
      .from("programs")
      .select("name")
      .eq("id", campaign.program_id)
      .single();

    // Calculate current completion percentage
    const {
      buildCampaignPlaybackMetrics,
    } = require("../services/campaignMetrics");

    const campaignWithStatus = {
      ...campaign,
      isActive:
        new Date(campaign.start_at) <= new Date() &&
        new Date(campaign.end_at) >= new Date() &&
        campaign.status === "active",
    };

    const { data: sessions } = await supabase
      .from("playing")
      .select("terminal_id")
      .eq("program_id", campaign.program_id);

    const terminalIds = sessions
      ? [...new Set(sessions.map((s) => s.terminal_id))]
      : null;

    const metrics = await buildCampaignPlaybackMetrics(
      [campaignWithStatus],
      [campaign.program_id],
      terminalIds,
      campaign.client_id,
    );

    const programMetrics = metrics[campaign.program_id] || {};

    // Get files for this client in this program
    const { data: files } = await supabase
      .from("files")
      .select("id, name, removed_at")
      .eq("program_id", campaign.program_id)
      .eq("client_id", campaign.client_id);

    const activeFiles = files
      ? files.filter((f) => f.removed_at === null).length
      : 0;
    const removedFiles = files
      ? files.filter((f) => f.removed_at !== null).length
      : 0;

    return res.json({
      success: true,
      campaign: {
        id: campaign.id,
        client_id: campaign.client_id,
        client_name: client?.name || "Unknown",
        program_id: campaign.program_id,
        program_name: program?.name || null,
        status: campaign.status,
        start_at: campaign.start_at,
        end_at: campaign.end_at,
        completed_at: campaign.completed_at,
        hours_bought: campaign.hours_bought,
        minutes_bought: campaign.hours_bought * 60,
      },
      metrics: {
        minutes_played: programMetrics.minutes_played_since_campaign_start || 0,
        hours_played: programMetrics.hours_played_since_campaign_start || 0,
        completion_percent: programMetrics.campaign_completion_percent || 0,
        share_of_voice_percent: programMetrics.share_of_voice_percent || 100,
      },
      files: {
        active: activeFiles,
        removed: removedFiles,
        total: files ? files.length : 0,
      },
    });
  } catch (error) {
    console.error("❌ Error getting campaign status:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to get campaign status",
      details: error.message,
    });
  }
});

/**
 * GET /admin/campaigns/list
 * List all campaigns with pagination
 * Query params: ?status=active&limit=50&offset=0
 */
router.get("/campaigns/list", async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from("campaign")
      .select("*, client(name), programs!program_id(name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data: campaigns, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch campaigns: ${error.message}`);
    }

    // Add isActive flag
    const now = new Date();
    const campaignsWithStatus = (campaigns || []).map((c) => ({
      ...c,
      isActive:
        new Date(c.start_at) <= now &&
        new Date(c.end_at) >= now &&
        c.status === "active",
    }));

    return res.json({
      success: true,
      campaigns: campaignsWithStatus,
      pagination: {
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: count > parseInt(offset) + parseInt(limit),
      },
    });
  } catch (error) {
    console.error("❌ Error listing campaigns:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to list campaigns",
      details: error.message,
    });
  }
});

/**
 * PATCH /admin/campaigns/:campaignId/status
 * Update campaign status
 *
 * Body:
 * {
 *   "status": "active" | "completed" | "paused" | "cancelled"
 * }
 */
router.patch("/campaigns/:campaignId/status", async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: status",
      });
    }

    const validStatuses = [
      "active",
      "completed",
      "paused",
      "cancelled",
      "planned",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Build update payload
    const updatePayload = { status };
    if (status === "completed") {
      updatePayload.completed_at = new Date().toISOString();
    }

    const { data: campaign, error: updateError } = await supabase
      .from("campaign")
      .update(updatePayload)
      .eq("id", campaignId)
      .select()
      .single();

    if (updateError || !campaign) {
      throw new Error(`Failed to update campaign: ${updateError?.message}`);
    }

    console.log(`✅ Campaign ${campaignId} status updated to '${status}'`);

    // Recompute playlist schedule when campaign is cancelled, paused, or completed
    if (
      ["cancelled", "paused", "completed"].includes(status) &&
      campaign.program_id
    ) {
      try {
        await computeScheduleForProgram(campaign.program_id);
        console.log(
          `📅 Playlist schedule recomputed for program ${campaign.program_id}`,
        );
      } catch (scheduleError) {
        console.warn(
          `⚠️  Failed to recompute playlist schedule: ${scheduleError.message}`,
        );
      }
    }

    return res.json({
      success: true,
      message: `Campaign ${campaignId} status updated to '${status}'`,
      campaign,
    });
  } catch (error) {
    console.error("❌ Error updating campaign status:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to update campaign status",
      details: error.message,
    });
  }
});

/**
 * POST /admin/campaigns/:campaignId/assign-client
 * Assign or reassign a campaign to a different client
 *
 * Body:
 * {
 *   "client_id": 5
 * }
 */
router.post("/campaigns/:campaignId/assign-client", async (req, res) => {
  try {
    const campaignId = parseInt(req.params.campaignId);
    const { client_id } = req.body;

    if (!client_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: client_id",
      });
    }

    // Verify client exists
    const { data: client, error: clientError } = await supabase
      .from("client")
      .select("id, name")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return res.status(404).json({
        success: false,
        error: `Client ${client_id} not found`,
      });
    }

    // Update campaign
    const { data: campaign, error: updateError } = await supabase
      .from("campaign")
      .update({ client_id })
      .eq("id", campaignId)
      .select()
      .single();

    if (updateError || !campaign) {
      throw new Error(`Failed to assign client: ${updateError?.message}`);
    }

    console.log(
      `✅ Campaign ${campaignId} assigned to client ${client_id} (${client.name})`,
    );

    return res.json({
      success: true,
      message: `Campaign assigned to ${client.name}`,
      campaign,
    });
  } catch (error) {
    console.error("❌ Error assigning client:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to assign client to campaign",
      details: error.message,
    });
  }
});

/**
 * POST /admin/media/sync
 * Manually trigger media sync from ColorLight
 */
router.post("/media/sync", async (req, res) => {
  try {
    console.log(`\n🔧 Manual media sync triggered by admin`);

    const result = await syncMediaFromColorLight();

    if (result.success) {
      return res.json({
        success: true,
        message: "Media sync completed successfully",
        results: {
          total_fetched: result.total_fetched,
          total_processed: result.total_processed,
          files_with_client_id: result.files_with_client_id,
          files_without_client_id: result.files_without_client_id,
          upsert_results: result.upsert_results,
          duration_ms: result.duration_ms,
        },
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Media sync completed with errors",
        results: result,
        errors: result.errors,
      });
    }
  } catch (error) {
    console.error("❌ Manual media sync error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to trigger media sync",
      details: error.message,
    });
  }
});

/**
 * POST /admin/campaigns/check-completions
 * Manually trigger campaign completion check
 * Useful for testing or forcing immediate completion check
 */
router.post("/campaigns/check-completions", async (req, res) => {
  try {
    console.log("🔍 Manual campaign completion check triggered...");

    const result = await monitorAndAutoComplete();

    return res.json({
      success: true,
      message: "Completion check finished",
      results: {
        campaigns_checked: result.campaigns_checked,
        campaigns_completed: result.campaigns_completed,
        completion_results: result.completion_results,
      },
    });
  } catch (error) {
    console.error("❌ Error checking completions:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to check campaign completions",
      details: error.message,
    });
  }
});

/**
 * POST /admin/snapshots/create
 * Manually create a Share of Voice snapshot
 * Body (optional):
 * {
 *   "date": "2025-11-25"  // Optional, defaults to yesterday
 * }
 */
router.post("/snapshots/create", async (req, res) => {
  try {
    const { date } = req.body || {};

    const snapshotDate = date
      ? new Date(date)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    console.log(
      `📸 Manual snapshot creation triggered for ${snapshotDate.toISOString()}`,
    );

    const result = await createShareOfVoiceSnapshot(snapshotDate);

    if (result.success) {
      return res.json({
        success: true,
        message: "Snapshot created successfully",
        results: {
          snapshot_date: result.snapshot_date,
          programs_processed: result.programs_processed,
          snapshots_created: result.snapshots_created,
        },
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Snapshot creation completed with errors",
        results: result,
        errors: result.errors,
      });
    }
  } catch (error) {
    console.error("❌ Manual snapshot error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to create snapshot",
      details: error.message,
    });
  }
});

/**
 * GET /admin/programs/list
 * List all available programs with file counts
 * Helps identify which programs can be used for campaigns
 */
router.get("/programs/list", async (req, res) => {
  try {
    const { data: files, error } = await supabase
      .from("files")
      .select("program_id, client_id, name, removed_at")
      .not("program_id", "is", null);

    if (error) {
      throw new Error(`Failed to fetch programs: ${error.message}`);
    }

    // Group by program
    const programsMap = {};

    files.forEach((f) => {
      if (!programsMap[f.program_id]) {
        programsMap[f.program_id] = {
          program_id: f.program_id,
          total_files: 0,
          active_files: 0,
          clients: {},
        };
      }

      programsMap[f.program_id].total_files++;

      if (f.removed_at === null) {
        programsMap[f.program_id].active_files++;

        if (f.client_id) {
          if (!programsMap[f.program_id].clients[f.client_id]) {
            programsMap[f.program_id].clients[f.client_id] = 0;
          }
          programsMap[f.program_id].clients[f.client_id]++;
        }
      }
    });

    // Extract unique program IDs
    const programIds = Object.keys(programsMap).map((id) => parseInt(id));

    // Fetch program names from programs table
    const { data: programsData, error: programsError } = await supabase
      .from("programs")
      .select("id, name")
      .in("id", programIds);

    if (programsError) {
      console.warn("Failed to fetch program names:", programsError.message);
    }

    // Create a map of program_id -> program_name
    const programNamesMap = {};
    if (programsData) {
      programsData.forEach((p) => {
        programNamesMap[p.id] = p.name;
      });
    }

    const programs = Object.values(programsMap).map((p) => ({
      program_id: p.program_id,
      program_name: programNamesMap[p.program_id] || null,
      total_files: p.total_files,
      active_files: p.active_files,
      removed_files: p.total_files - p.active_files,
      clients: Object.entries(p.clients).map(([clientId, count]) => ({
        client_id: parseInt(clientId),
        file_count: count,
        share_percent: p.active_files > 0 ? (count / p.active_files) * 100 : 0,
      })),
    }));

    return res.json({
      success: true,
      programs: programs.sort((a, b) => b.active_files - a.active_files),
      total_programs: programs.length,
    });
  } catch (error) {
    console.error("❌ Error listing programs:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to list programs",
      details: error.message,
    });
  }
});

/**
 * GET /admin/clients/list
 * List all clients
 */
router.get("/clients/list", async (req, res) => {
  try {
    const { data: clients, error } = await supabase
      .from("client")
      .select("id, name, email, created_at")
      .order("name");

    if (error) {
      throw new Error(`Failed to fetch clients: ${error.message}`);
    }

    return res.json({
      success: true,
      clients: clients || [],
      total_clients: clients ? clients.length : 0,
    });
  } catch (error) {
    console.error("❌ Error listing clients:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to list clients",
      details: error.message,
    });
  }
});

module.exports = router;
