const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");
const { buildGpsHeatmapData } = require("../services/heatmap");

// GET /gps - Returns GPS data including latest GPS per terminal and heatmap data for client's active programs
router.get("/", async (req, res) => {
  try {
    const client = req.client; // set by auth middleware

    // Parse query parameters for GPS heat map
    const { gpsStartDate, gpsEndDate, gpsProgramId, gpsDays = "7" } = req.query;

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

    // If no active programs, return early with empty GPS data
    if (programIds.length === 0) {
      return res.json({
        client: { id: client.id, name: client.name, activePrograms: [] },
        terminals: [],
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

    // Get all terminals that have ever played these programs (for heatmap data)
    let allTerminalIds = terminalIds;
    let heatmapData = null;

    try {
      const { data: allTerminalsForPrograms, error: allTerminalsError } =
        await supabase
          .from("playing")
          .select("terminal_id")
          .in("program_id", programIds);

      // Get unique terminal IDs from the results
      allTerminalIds = [
        ...new Set((allTerminalsForPrograms || []).map((t) => t.terminal_id)),
      ];
      console.log(
        "All terminals that ever played these programs:",
        allTerminalIds
      );

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
    } catch (heatmapError) {
      console.warn("Failed to build GPS heat map data:", heatmapError.message);
      // Don't fail the entire request if heatmap fails
    }

    // If no terminals are currently playing, return heatmap data only
    if (terminalIds.length === 0) {
      return res.json({
        client: {
          id: client.id,
          name: client.name,
          activePrograms: programIds,
        },
        terminals: [],
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
      });
    }

    // 3) For live GPS, get the most recent GPS per terminal from terminal_gps_data
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

    // Build output terminals list with GPS data
    const terminalsOut = terminalIds.map((terminalId) => {
      const gps = latestGpsByTerminal[terminalId] || null;
      return {
        terminalId: terminalId,
        gps: gps
          ? {
              longitude: gps.longitude,
              latitude: gps.latitude,
              last_updated: gps.inserted_at,
            }
          : null,
      };
    });

    const response = {
      client: { id: client.id, name: client.name, activePrograms: programIds },
      terminals: terminalsOut,
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
      .json({ error: "Failed to fetch GPS data", details: err.message });
  }
});

module.exports = router;
