const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");
const { buildCampaignPlaybackMetrics } = require("../services/campaignMetrics");
const { fetchHistoricalTerminals } = require("../services/historicalTerminals");
const { buildZoneCoverageMetrics } = require("../services/zoneCoverage");
const { getPlaylistsByCampaignIds } = require("../services/campaignPlaylists");

// Simple in-memory cache to prevent duplicate expensive queries (disabled via flag)
// Key format: "clientId:zoneDays:zoneStartDate:zoneEndDate"
const ENABLE_CACHE = false; // Disabled for real-time analytics
const analyticsCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Helper function to get cache key from request
function getCacheKey(clientId, query) {
  const { zoneDays, zoneStartDate, zoneEndDate, zoneLimit } = query;
  return `${clientId}:${zoneDays || ""}:${zoneStartDate || ""}:${
    zoneEndDate || ""
  }:${zoneLimit || ""}`;
}

// Helper function to clean up expired cache entries
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, value] of analyticsCache.entries()) {
    if (now > value.expiresAt) {
      analyticsCache.delete(key);
    }
  }
}

// GET /analytics - Returns client's analytics including summary statistics, terminals, and historical data
router.get("/", async (req, res) => {
  try {
    const client = req.client; // set by auth middleware

    // Parse query parameters for zone coverage filtering
    const { zoneDays, zoneStartDate, zoneEndDate } = req.query;
    const zoneLimitRaw = req.query.zoneLimit;
    const zoneLimit = Math.max(
      1,
      Math.min(50, parseInt(zoneLimitRaw, 10) || 50)
    );

    // Check cache first (disabled when ENABLE_CACHE=false)
    const cacheKey = getCacheKey(client.id, req.query);
    if (ENABLE_CACHE) {
      const cachedResult = analyticsCache.get(cacheKey);
      if (cachedResult && Date.now() < cachedResult.expiresAt) {
        console.log(
          `[Analytics Cache] Returning cached result for client ${client.id}`
        );
        return res.json(cachedResult.data);
      }
    }

    // Clean up expired cache entries periodically (disabled when ENABLE_CACHE=false)
    if (ENABLE_CACHE && Math.random() < 0.1) {
      cleanExpiredCache();
    }

    // 1) Resolve client's campaigns (both active and inactive)
    const nowIso = new Date().toISOString();
    const { data: allCampaigns, error: campaignsError } = await supabase
      .from("campaign")
      .select(
        "id, program_id, mode, status, start_at, end_at, hours_bought, completed_at"
      )
      .eq("client_id", client.id)
      .in("status", ["active", "planned", "completed", "inactive"]);

    if (campaignsError) {
      return res.status(500).json({
        error: "Failed to fetch client's campaigns",
        details: campaignsError.message,
      });
    }

    // Mark each campaign as active or inactive based on date range
    // A campaign is active if: status="active" AND completed_at IS NULL AND within date range
    const rawCampaignsWithStatus = (allCampaigns || []).map((campaign) => {
      const isActive =
        campaign.start_at <= nowIso &&
        campaign.end_at >= nowIso &&
        campaign.status === "active" &&
        campaign.completed_at === null;
      return { ...campaign, isActive };
    });

    // Expand split campaigns: one entry per playlist so all program_ids are tracked
    const allCampaignIds = rawCampaignsWithStatus.map((c) => c.id).filter(Boolean);
    const playlistsByCampaign = allCampaignIds.length > 0
      ? await getPlaylistsByCampaignIds(allCampaignIds)
      : {};

    const campaignsWithActiveStatus = rawCampaignsWithStatus.flatMap((c) => {
      const playlists = playlistsByCampaign[c.id];
      if (c.mode === "split" && playlists && playlists.length > 0) {
        return playlists.map((p) => ({
          ...c,
          program_id: p.program_id,
          hours_bought: p.hours_bought,
        }));
      }
      return [c];
    });

    const programIds = Array.from(
      new Set(campaignsWithActiveStatus.map((c) => c.program_id))
    );

    // Filter to only active program IDs for the activePrograms field
    const activeProgramIds = Array.from(
      new Set(
        campaignsWithActiveStatus
          .filter((c) => c.isActive)
          .map((c) => c.program_id)
      )
    );

    console.log(
      "Total campaigns found:",
      campaignsWithActiveStatus.length || 0
    );
    console.log(
      "Active campaigns:",
      campaignsWithActiveStatus.filter((c) => c.isActive).length
    );
    console.log("Program IDs from campaigns:", programIds);
    console.log("Active Program IDs:", activeProgramIds);

    // If no active programs, return early with empty data (no historical data for completed campaigns)
    if (activeProgramIds.length === 0) {
      return res.json({
        client: { id: client.id, name: client.name, activePrograms: [] },
        terminals: [],
        summary: {
          total_terminals: 0,
          terminals_playing: 0,
          terminals_offline: 0,
          historical_terminals_count: 0,
        },
        historical_terminals: [],
        campaign_metrics: {},
        zone_coverage: {},
      });
    }

    // Fetch ALL playing sessions once to avoid duplicate queries in services
    // This query combines data needed by campaignMetrics, zoneCoverage, and historicalTerminals
    // Only fetch for active programs
    const { data: allPlayingSessions, error: allPlayingError } = await supabase
      .from("playing")
      .select(
        "terminal_id, program_id, program_name, file_name, source, started_at, ended_at, status"
      )
      .in("program_id", activeProgramIds);

    if (allPlayingError) {
      console.warn(
        "Failed to fetch playing sessions:",
        allPlayingError.message
      );
      return res.status(500).json({
        error: "Failed to fetch playing sessions",
        details: allPlayingError.message,
      });
    }

    // Extract terminal IDs from playing sessions
    const terminalIds = Array.from(
      new Set((allPlayingSessions || []).map((s) => s.terminal_id))
    );

    // Compute campaign playback metrics per program via service
    // Only include active campaigns for metrics
    const activeCampaignsOnly = campaignsWithActiveStatus.filter(
      (c) => c.isActive
    );
    const playbackMetricsByProgram = await buildCampaignPlaybackMetrics(
      activeCampaignsOnly,
      activeProgramIds,
      terminalIds.length > 0 ? terminalIds : null,
      client.id // Pass client_id for Share of Voice
    );

    // All metrics are for active programs, so set isActive to true
    for (const [programId, metrics] of Object.entries(
      playbackMetricsByProgram
    )) {
      metrics.isActive = true;
    }

    // If no campaigns at all, return early with empty data
    if (programIds.length === 0) {
      return res.json({
        client: { id: client.id, name: client.name, activePrograms: [] },
        terminals: [],
        summary: {
          total_terminals: 0,
          terminals_playing: 0,
          terminals_offline: 0,
          historical_terminals_count: 0,
        },
        historical_terminals: [],
        campaign_metrics: {},
        zone_coverage: {},
      });
    }

    // 2) Use already-fetched playing sessions (allPlayingSessions from above)
    // terminalIds already extracted above for campaign metrics

    // Filter for currently playing terminals only (for display)
    const currentlyPlayingRows = (allPlayingSessions || []).filter(
      (p) => p.status === "current"
    );

    // Get all terminals that have played these programs for historical data
    // Only for active programs
    let allHistoricalTerminals = [];
    try {
      allHistoricalTerminals = await fetchHistoricalTerminals(
        activeProgramIds,
        allPlayingSessions || []
      );
    } catch (error) {
      console.warn("Failed to fetch historical terminals data:", error.message);
    }

    // If no terminal IDs from sessions, fall back to historical terminals for coverage
    const terminalIdsForCoverage =
      terminalIds.length > 0
        ? terminalIds
        : Array.from(
            new Set((allHistoricalTerminals || []).map((t) => t.terminal_id))
          );

    // 3) Fetch terminal metadata
    const { data: terminalRows, error: terminalsError } = await supabase
      .from("terminals")
      .select("terminalid, name, group_name, last_report_time, power_status")
      .in("terminalid", terminalIds);

    // 3.5) Fetch terminal online status from terminal_status_log
    // Use RPC to get only the latest status per terminal (much more efficient than fetching all rows)
    const { data: terminalStatusRows, error: statusError } = await supabase.rpc(
      "get_latest_terminal_status",
      { p_terminal_ids: terminalIds }
    );

    // Create a map of latest status for each terminal
    const latestStatusByTerminal = {};
    if (!statusError && terminalStatusRows) {
      for (const statusRow of terminalStatusRows) {
        latestStatusByTerminal[statusRow.terminal_id] = statusRow.status;
      }
    }

    if (terminalsError) {
      return res.status(500).json({
        error: "Failed to fetch terminal metadata",
        details: terminalsError.message,
      });
    }

    // Build output terminals list (only for currently playing terminals)
    const playingByTerminalId = Object.fromEntries(
      currentlyPlayingRows.map((p) => [p.terminal_id, p])
    );

    // Get terminals that are currently playing for the output list
    const currentlyPlayingTerminalIds = currentlyPlayingRows.map(
      (p) => p.terminal_id
    );
    const terminalsForDisplay = (terminalRows || []).filter((t) =>
      currentlyPlayingTerminalIds.includes(t.terminalid)
    );

    const terminalsOut = terminalsForDisplay.map((terminal) => {
      const playing = playingByTerminalId[terminal.terminalid] || null;
      const isOnline = latestStatusByTerminal[terminal.terminalid] === "online";

      return {
        terminalId: terminal.terminalid,
        name: terminal.name || null,
        group_name: terminal.group_name || null,
        last_report_time: terminal.last_report_time || null,
        power_status: terminal.power_status || null,
        isOnline: isOnline,
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

    const terminalsPlayingCount = currentlyPlayingRows.length;
    const offlineCount = (terminalRows || []).filter(
      (t) => t.power_status === "off"
    ).length;

    // Calculate zone coverage date range based on query parameters
    // Only for active campaigns
    let zoneStartDateFinal = null;
    let zoneEndDateFinal = nowIso;

    if (zoneEndDate) {
      // Custom end date provided
      zoneEndDateFinal = zoneEndDate;
    } else {
      // Calculate effective end date from active campaigns only
      // For active campaigns: use now or end_at (whichever is earlier)
      if (activeCampaignsOnly && activeCampaignsOnly.length > 0) {
        const effectiveEndDates = activeCampaignsOnly.map((c) => {
          const endAt = new Date(c.end_at);
          const now = new Date(nowIso);
          return endAt < now ? endAt : now;
        });
        const latestEnd = new Date(Math.max(...effectiveEndDates));
        zoneEndDateFinal = latestEnd.toISOString();
      }
    }

    if (zoneStartDate) {
      // Custom start date provided
      zoneStartDateFinal = zoneStartDate;
    } else if (zoneDays) {
      // Calculate start date based on days back from end date
      const endDate = zoneEndDate
        ? new Date(zoneEndDate)
        : new Date(zoneEndDateFinal);
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - parseInt(zoneDays));
      zoneStartDateFinal = startDate.toISOString().split("T")[0];
    } else {
      // Default: use campaign start timestamp (full campaign history from exact start time)
      if (activeCampaignsOnly && activeCampaignsOnly.length > 0) {
        const startDates = activeCampaignsOnly.map((c) => new Date(c.start_at));
        const earliestStart = new Date(Math.min(...startDates));
        zoneStartDateFinal = earliestStart.toISOString(); // Use full timestamp, not just date
      }
    }

    // Build zone coverage metrics with Share of Voice
    // Only for active programs
    let zoneCoverage = {};

    if (zoneStartDateFinal && terminalIdsForCoverage.length > 0) {
      try {
        zoneCoverage = await buildZoneCoverageMetrics(
          activeProgramIds,
          terminalIdsForCoverage,
          zoneStartDateFinal,
          zoneEndDateFinal,
          zoneLimit,
          client.id // Pass client_id for share of voice calculation
        );

        // All zone coverage is for active programs
        for (const [programId, coverage] of Object.entries(zoneCoverage)) {
          coverage.isActive = true;
        }
      } catch (error) {
        console.warn("Failed to build zone coverage metrics:", error.message);
      }
    }

    // Remove internal _byCampaign field before sending to client
    // _byCampaign is only used internally by campaignCompletion service
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

    // Store in cache before sending response (disabled when ENABLE_CACHE=false)
    if (ENABLE_CACHE) {
      analyticsCache.set(cacheKey, {
        data: response,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      console.log(
        `[Analytics Cache] Cached result for client ${client.id} (TTL: ${
          CACHE_TTL_MS / 1000
        }s)`
      );
    }

    res.json(response);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to build analytics data", details: err.message });
  }
});

module.exports = router;
