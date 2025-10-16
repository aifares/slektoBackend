const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");
const { buildCampaignPlaybackMetrics } = require("../services/campaignMetrics");
const { fetchHistoricalTerminals } = require("../services/historicalTerminals");
const { buildZoneCoverageMetrics } = require("../services/zoneCoverage");

// GET /analytics - Returns client's analytics including summary statistics, terminals, and historical data
router.get("/", async (req, res) => {
  try {
    const client = req.client; // set by auth middleware

    // Parse query parameters for zone coverage filtering
    const { zoneDays, zoneStartDate, zoneEndDate } = req.query;

    // 1) Resolve client's active programs (via campaigns in active window)
    const nowIso = new Date().toISOString();
    const { data: activeCampaigns, error: campaignsError } = await supabase
      .from("campaign")
      .select("program_id, status, start_at, end_at, hours_bought")
      .eq("client_id", client.id)
      .in("status", ["active", "planned"]) // consider planned in window
      .lte("start_at", nowIso)
      .gte("end_at", nowIso);

    if (campaignsError) {
      return res.status(500).json({
        error: "Failed to fetch client's campaigns",
        details: campaignsError.message,
      });
    }

    const programIds = Array.from(
      new Set((activeCampaigns || []).map((c) => c.program_id))
    );

    console.log("Active campaigns found:", activeCampaigns?.length || 0);
    console.log("Program IDs from campaigns:", programIds);

    // Compute campaign playback metrics per program via service
    const playbackMetricsByProgram = await buildCampaignPlaybackMetrics(
      activeCampaigns || [],
      programIds
    );

    // If no active programs, return early with empty data
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

    // 2) Fetch currently playing sessions for those programs
    const { data: playingRows, error: playingError } = await supabase
      .from("playing")
      .select(
        "terminal_id, program_id, program_name, file_name, source, started_at, status"
      )
      .in("program_id", programIds)
      .eq("status", "current");

    if (playingError) {
      return res.status(500).json({
        error: "Failed to fetch currently playing data",
        details: playingError.message,
      });
    }

    // Get terminal IDs from currently playing terminals only
    const terminalIds = Array.from(
      new Set((playingRows || []).map((p) => p.terminal_id))
    );

    // Get all terminals that have played these programs for historical data
    let allHistoricalTerminals = [];
    try {
      allHistoricalTerminals = await fetchHistoricalTerminals(programIds);
    } catch (error) {
      console.warn("Failed to fetch historical terminals data:", error.message);
    }

    // If no terminals are currently playing, return early
    if (terminalIds.length === 0) {
      return res.json({
        client: {
          id: client.id,
          name: client.name,
          activePrograms: programIds,
        },
        terminals: [],
        summary: {
          total_terminals: 0,
          terminals_playing: 0,
          terminals_offline: 0,
          historical_terminals_count: allHistoricalTerminals.length,
        },
        historical_terminals: allHistoricalTerminals,
        campaign_metrics: playbackMetricsByProgram,
        zone_coverage: {
          total_zones_visited: 0,
          total_zones_available: 0,
          coverage_percentage: 0,
          total_minutes_in_zones: 0,
          high_value_exposure_score: 0,
          zones: [],
          zone_type_distribution: {
            tourist: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
            shopping: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
            residential: {
              zones_count: 0,
              minutes: 0,
              hours: 0,
              percentage: 0,
            },
            mixed: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
          },
          date_range: { start: null, end: null },
        },
      });
    }

    // 3) Fetch terminal metadata
    const { data: terminalRows, error: terminalsError } = await supabase
      .from("terminals")
      .select("terminalid, name, group_name, last_report_time, power_status")
      .in("terminalid", terminalIds);

    // 3.5) Fetch terminal online status from terminal_status_log
    const { data: terminalStatusRows, error: statusError } = await supabase
      .from("terminal_status_log")
      .select("terminal_id, status, status_changed_at")
      .in("terminal_id", terminalIds)
      .order("status_changed_at", { ascending: false });

    // Create a map of latest status for each terminal
    const latestStatusByTerminal = {};
    if (!statusError && terminalStatusRows) {
      for (const statusRow of terminalStatusRows) {
        if (!latestStatusByTerminal[statusRow.terminal_id]) {
          latestStatusByTerminal[statusRow.terminal_id] = statusRow.status;
        }
      }
    }

    if (terminalsError) {
      return res.status(500).json({
        error: "Failed to fetch terminal metadata",
        details: terminalsError.message,
      });
    }

    // Build output terminals list
    const playingByTerminalId = Object.fromEntries(
      (playingRows || []).map((p) => [p.terminal_id, p])
    );

    const terminalsOut = (terminalRows || []).map((terminal) => {
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

    const terminalsPlayingCount = (playingRows || []).length;
    const offlineCount = (terminalRows || []).filter(
      (t) => t.power_status === "off"
    ).length;

    // Calculate zone coverage date range based on query parameters
    let zoneStartDateFinal = null;
    let zoneEndDateFinal = nowIso;

    if (zoneEndDate) {
      // Custom end date provided
      zoneEndDateFinal = zoneEndDate;
    }

    if (zoneStartDate) {
      // Custom start date provided
      zoneStartDateFinal = zoneStartDate;
    } else if (zoneDays) {
      // Calculate start date based on days back from end date
      const endDate = zoneEndDate ? new Date(zoneEndDate) : new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - parseInt(zoneDays));
      zoneStartDateFinal = startDate.toISOString().split("T")[0];
    } else {
      // Default: use campaign start date (full campaign history)
      if (activeCampaigns && activeCampaigns.length > 0) {
        const startDates = activeCampaigns.map((c) => new Date(c.start_at));
        const earliestStart = new Date(Math.min(...startDates));
        zoneStartDateFinal = earliestStart.toISOString().split("T")[0];
      }
    }

    // Build zone coverage metrics
    let zoneCoverage = {};

    if (zoneStartDateFinal && terminalIds.length > 0) {
      try {
        zoneCoverage = await buildZoneCoverageMetrics(
          programIds,
          terminalIds,
          zoneStartDateFinal,
          zoneEndDateFinal
        );
      } catch (error) {
        console.warn("Failed to build zone coverage metrics:", error.message);
      }
    }

    const response = {
      client: { id: client.id, name: client.name, activePrograms: programIds },
      terminals: terminalsOut,
      summary: {
        total_terminals: terminalsOut.length,
        terminals_playing: terminalsPlayingCount,
        terminals_offline: offlineCount,
        historical_terminals_count: allHistoricalTerminals.length,
      },
      historical_terminals: allHistoricalTerminals,
      campaign_metrics: playbackMetricsByProgram,
      zone_coverage: zoneCoverage,
    };

    res.json(response);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to build analytics data", details: err.message });
  }
});

module.exports = router;
