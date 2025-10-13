const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");
const { fetchMediaByProgramId } = require("../services/media");
const { buildGpsHeatmapData } = require("../services/heatmap");
const { buildCampaignPlaybackMetrics } = require("../services/campaignMetrics");
const { fetchHistoricalTerminals } = require("../services/historicalTerminals");

// moved to services/heatmap.js

// GET /clientData - Aggregated client data: active programs, terminals playing them, latest GPS per terminal, and GPS heat map data
router.get("/", async (req, res) => {
  try {
    const client = req.client; // set by auth middleware

    // Parse query parameters for GPS heat map
    const {
      includeHeatmap = "true",
      gpsStartDate,
      gpsEndDate,
      gpsProgramId,
      gpsDays = "7",
    } = req.query;

    // Set default date range for GPS data
    const endDate = gpsEndDate || new Date().toISOString().split("T")[0];
    const startDate =
      gpsStartDate ||
      new Date(Date.now() - parseInt(gpsDays) * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

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

    // Fetch program details for active programs
    let programDetails = [];
    if (programIds.length > 0) {
      const { data: programsData, error: programsError } = await supabase
        .from("programs")
        .select("id, name, download_status_time, files")
        .in("id", programIds);

      if (programsError) {
        console.warn("Failed to fetch program details:", programsError.message);
      } else {
        console.log("Programs found in database:", programsData?.length || 0);
        console.log("Program data:", programsData);
        programDetails = (programsData || []).map((program) => ({
          id: program.id,
          name: program.name,
          download_status_time: program.download_status_time,
          files: program.files,
        }));
      }
    }

    // Enrich programs with thumbnail image (if available)
    let programDetailsWithThumb = programDetails;
    if (programIds.length > 0 && programDetails.length > 0) {
      try {
        const thumbnails = await Promise.all(
          programIds.map(async (pid) => {
            const mediaFiles = await fetchMediaByProgramId(pid);
            const thumbUrl =
              (mediaFiles && mediaFiles[0] && mediaFiles[0].thumbnail_url) ||
              null;
            return [pid, thumbUrl];
          })
        );
        const thumbByProgramId = Object.fromEntries(thumbnails);
        programDetailsWithThumb = programDetails.map((p) => ({
          ...p,
          thumbnail_url: thumbByProgramId[p.id] || null,
        }));
      } catch (thumbErr) {
        console.warn("Failed to fetch program thumbnails:", thumbErr.message);
      }
    }

    // Compute campaign playback metrics per program via service
    const playbackMetricsByProgram = await buildCampaignPlaybackMetrics(
      activeCampaigns || [],
      programIds
    );

    if (programIds.length === 0) {
      return res.json({
        client: { id: client.id, name: client.name, activePrograms: [] },
        programs: [], // No active programs
        terminals: [],
        summary: {
          total_terminals: 0,
          terminals_playing: 0,
          terminals_offline: 0,
        },
        heatmap: {
          summary: {
            totalGpsPoints: 0,
            programsCount: 0,
            terminalsCount: 0,
            distanceMiles: 0,
            dateRange: `${startDate} to ${endDate}`,
          },
          programs: [],
        },
        historical_terminals: [],
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

    if (terminalIds.length === 0) {
      // Even if no terminals are currently playing, we still want to show heatmap data
      // for all terminals that have historically played these programs
      let heatmapData = null;
      let allHistoricalTerminals = [];

      try {
        const { data: allTerminalsForPrograms, error: allTerminalsError } =
          await supabase
            .from("playing")
            .select("terminal_id")
            .in("program_id", programIds);

        // Get unique terminal IDs from the results
        const allTerminalIds = [
          ...new Set((allTerminalsForPrograms || []).map((t) => t.terminal_id)),
        ];

        if (allTerminalIds.length > 0) {
          heatmapData = await buildGpsHeatmapData(
            client.id,
            programIds,
            allTerminalIds,
            startDate,
            endDate,
            gpsProgramId
          );
        }

        // Also get historical terminals data for the early return
        const { data: historicalTerminalsData, error: historicalError } =
          await supabase
            .from("playing")
            .select(
              "terminal_id, program_id, program_name, started_at, ended_at, status"
            )
            .in("program_id", programIds);

        if (!historicalError && historicalTerminalsData) {
          // Group by terminal_id and get unique terminals with their program info
          const terminalMap = new Map();
          historicalTerminalsData.forEach((record) => {
            if (!terminalMap.has(record.terminal_id)) {
              terminalMap.set(record.terminal_id, {
                terminal_id: record.terminal_id,
                programs_played: [],
                first_played_at: record.started_at,
                last_played_at: record.ended_at || record.started_at,
              });
            }

            const terminal = terminalMap.get(record.terminal_id);

            // Add program if not already in list
            if (
              !terminal.programs_played.find(
                (p) => p.program_id === record.program_id
              )
            ) {
              terminal.programs_played.push({
                program_id: record.program_id,
                program_name: record.program_name,
              });
            }

            // Update time ranges
            if (
              new Date(record.started_at) < new Date(terminal.first_played_at)
            ) {
              terminal.first_played_at = record.started_at;
            }
            if (
              record.ended_at &&
              new Date(record.ended_at) > new Date(terminal.last_played_at)
            ) {
              terminal.last_played_at = record.ended_at;
            }
          });

          allHistoricalTerminals = Array.from(terminalMap.values());
        }
      } catch (heatmapError) {
        console.warn(
          "Failed to build historical heatmap data:",
          heatmapError.message
        );
      }

      // No terminals are currently playing, so return empty terminals array

      // Enrich programs with playback metrics if available
      const programsOut = (programDetailsWithThumb || []).map((p) => {
        const metrics = playbackMetricsByProgram[p.id] || {
          minutes_played_since_campaign_start: 0,
          campaign_completion_percent: 0,
          campaign_hours_bought: 0,
          campaign_minutes_bought: 0,
          hours_played_since_campaign_start: 0,
          campaign_start_at: null,
          campaign_end_at: null,
        };
        return { ...p, ...metrics };
      });

      return res.json({
        client: {
          id: client.id,
          name: client.name,
          activePrograms: programIds,
        },
        programs: programsOut,
        terminals: [], // No terminals currently playing
        summary: {
          total_terminals: 0,
          terminals_playing: 0,
          terminals_offline: 0,
          historical_terminals_count: allHistoricalTerminals.length,
        },
        heatmap: heatmapData || {
          summary: {
            totalGpsPoints: 0,
            programsCount: 0,
            terminalsCount: 0,
            distanceMiles: 0,
            dateRange: `${startDate} to ${endDate}`,
          },
          programs: [],
        },
        historical_terminals: allHistoricalTerminals,
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

    // 4) For live GPS, get the most recent GPS per terminal from terminal_gps_data
    // Supabase does not support DISTINCT ON; fetch latest by ordering and reducing client-side
    const { data: gpsRows, error: gpsError } = await supabase
      .from("terminal_gps_data")
      .select("terminal_id, longitude, latitude, inserted_at")
      .in("terminal_id", terminalIds)
      .order("terminal_id", { ascending: true })
      .order("inserted_at", { ascending: false });

    if (gpsError) {
      return res.status(500).json({
        error: "Failed to fetch GPS data",
        details: gpsError.message,
      });
    }

    const latestGpsByTerminal = {};
    for (const row of gpsRows || []) {
      if (!latestGpsByTerminal[row.terminal_id]) {
        latestGpsByTerminal[row.terminal_id] = row;
      }
    }

    // Index helpers
    const terminalMetaById = Object.fromEntries(
      (terminalRows || []).map((t) => [t.terminalid, t])
    );

    // Build output terminals list - include ALL terminals, not just currently playing ones
    const playingByTerminalId = Object.fromEntries(
      (playingRows || []).map((p) => [p.terminal_id, p])
    );

    const terminalsOut = (terminalRows || []).map((terminal) => {
      const playing = playingByTerminalId[terminal.terminalid] || null;
      const gps = latestGpsByTerminal[terminal.terminalid] || null;
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
        gps: gps
          ? {
              longitude: gps.longitude,
              latitude: gps.latitude,
              last_updated: gps.inserted_at,
            }
          : null,
      };
    });

    const terminalsPlayingCount = (playingRows || []).length;
    const offlineCount = (terminalRows || []).filter(
      (t) => t.power_status === "off"
    ).length;

    // 5) GPS Heat Map Data (always included)
    let heatmapData = null;
    try {
      // Get all terminals that have ever played these programs (not just currently online)
      const { data: allTerminalsForPrograms, error: allTerminalsError } =
        await supabase
          .from("playing")
          .select("terminal_id")
          .in("program_id", programIds);

      // Get unique terminal IDs from the results
      const allTerminalIds = [
        ...new Set((allTerminalsForPrograms || []).map((t) => t.terminal_id)),
      ];
      console.log(
        "All terminals that ever played these programs:",
        allTerminalIds
      );

      heatmapData = await buildGpsHeatmapData(
        client.id,
        programIds,
        allTerminalIds.length > 0 ? allTerminalIds : terminalIds, // Use all historical terminals if available
        startDate,
        endDate,
        gpsProgramId
      );
    } catch (heatmapError) {
      console.warn("Failed to build GPS heat map data:", heatmapError.message);
      // Don't fail the entire request if heatmap fails
    }

    // Get all terminals that have played these programs for the response
    let allHistoricalTerminals = [];
    try {
      allHistoricalTerminals = await fetchHistoricalTerminals(programIds);
    } catch (error) {
      console.warn("Failed to fetch historical terminals data:", error.message);
    }

    // Enrich programs with playback metrics if available
    const programsOut = (programDetailsWithThumb || []).map((p) => {
      const metrics = playbackMetricsByProgram[p.id] || {
        minutes_played_since_campaign_start: 0,
        campaign_completion_percent: 0,
        campaign_hours_bought: 0,
        campaign_minutes_bought: 0,
        hours_played_since_campaign_start: 0,
        campaign_start_at: null,
        campaign_end_at: null,
      };
      return { ...p, ...metrics };
    });

    const response = {
      client: { id: client.id, name: client.name, activePrograms: programIds },
      programs: programsOut,
      terminals: terminalsOut,
      historical_terminals: allHistoricalTerminals,
      summary: {
        total_terminals: terminalsOut.length,
        terminals_playing: terminalsPlayingCount,
        terminals_offline: offlineCount,
        historical_terminals_count: allHistoricalTerminals.length,
      },
      heatmap: heatmapData || {
        summary: {
          totalGpsPoints: 0,
          programsCount: 0,
          terminalsCount: 0,
          distanceMiles: 0,
          dateRange: `${startDate} to ${endDate}`,
        },
        programs: [],
      },
    };

    res.json(response);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to build client data", details: err.message });
  }
});

module.exports = router;
