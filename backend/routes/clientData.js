const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");

// Helper function to build GPS heat map data with program correlation
async function buildGpsHeatmapData(
  clientId,
  programIds,
  terminalIds,
  startDate,
  endDate,
  filterProgramId
) {
  // Filter programs if specific program requested
  const targetProgramIds = filterProgramId
    ? [parseInt(filterProgramId)]
    : programIds;

  if (targetProgramIds.length === 0) {
    return null;
  }

  // 1) Get all GPS points for client's terminals in date range (with higher limit)
  const { data: gpsPoints, error: gpsError } = await supabase
    .from("terminal_gps_data")
    .select("terminal_id, longitude, latitude, inserted_at")
    .in("terminal_id", terminalIds)
    .gte("data_date", startDate)
    .lte("data_date", endDate)
    .order("inserted_at", { ascending: true })
    .limit(5000); // Increase limit to get more comprehensive data

  if (gpsError) {
    throw new Error(`Failed to fetch GPS points: ${gpsError.message}`);
  }

  if (!gpsPoints || gpsPoints.length === 0) {
    return {
      summary: { totalGpsPoints: 0, programsCount: 0, terminalsCount: 0 },
      programs: {},
    };
  }

  // 2) Get playing sessions for the same terminals and date range
  const { data: playingSessions, error: playingError } = await supabase
    .from("playing")
    .select(
      "terminal_id, program_id, program_name, started_at, ended_at, status"
    )
    .in("terminal_id", terminalIds)
    .in("program_id", targetProgramIds)
    .gte("started_at", `${startDate}T00:00:00`)
    .lte("started_at", `${endDate}T23:59:59`)
    .order("started_at", { ascending: true });

  if (playingError) {
    throw new Error(
      `Failed to fetch playing sessions: ${playingError.message}`
    );
  }

  // 3) Correlate GPS points with playing sessions
  const programHeatmapData = {};
  const terminalCount = new Set();

  for (const gpsPoint of gpsPoints) {
    const gpsTime = new Date(gpsPoint.inserted_at);

    // Find what program was playing at this terminal at this time
    const activeSession = playingSessions?.find(
      (session) =>
        session.terminal_id === gpsPoint.terminal_id &&
        session.status === "current" &&
        new Date(session.started_at) <= gpsTime &&
        (!session.ended_at || new Date(session.ended_at) >= gpsTime)
    );

    // If no current session, check completed sessions that were active at this time
    const completedSession = !activeSession
      ? playingSessions?.find(
          (session) =>
            session.terminal_id === gpsPoint.terminal_id &&
            session.status === "completed" &&
            new Date(session.started_at) <= gpsTime &&
            session.ended_at &&
            new Date(session.ended_at) >= gpsTime
        )
      : null;

    const session = activeSession || completedSession;

    if (session) {
      const programId = session.program_id.toString();

      if (!programHeatmapData[programId]) {
        programHeatmapData[programId] = {
          program_id: session.program_id,
          program_name: session.program_name,
          points: [],
          totalPoints: 0,
          uniqueLocations: new Set(),
          terminals: new Set(),
        };
      }

      programHeatmapData[programId].points.push({
        latitude: gpsPoint.latitude,
        longitude: gpsPoint.longitude,
        timestamp: gpsPoint.inserted_at,
        terminal_id: gpsPoint.terminal_id,
        intensity: 1.0,
      });

      programHeatmapData[programId].totalPoints++;
      programHeatmapData[programId].uniqueLocations.add(
        `${gpsPoint.latitude},${gpsPoint.longitude}`
      );
      programHeatmapData[programId].terminals.add(gpsPoint.terminal_id);
      terminalCount.add(gpsPoint.terminal_id);
    }
  }

  // 4) Calculate coverage and density for each program
  const processedPrograms = {};
  for (const [programId, data] of Object.entries(programHeatmapData)) {
    if (data.points.length === 0) continue;

    const lats = data.points.map((p) => p.latitude);
    const lngs = data.points.map((p) => p.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    processedPrograms[programId] = {
      ...data,
      uniqueLocations: data.uniqueLocations.size,
      terminals: Array.from(data.terminals),
      coverage: {
        minLat,
        maxLat,
        minLng,
        maxLng,
        centerLat: (minLat + maxLat) / 2,
        centerLng: (minLng + maxLng) / 2,
      },
      density:
        data.points.length > 100
          ? "high"
          : data.points.length > 50
          ? "medium"
          : "low",
      avgPointsPerLocation: data.points.length / data.uniqueLocations.size,
    };

    // Remove the Set objects for JSON serialization
    delete processedPrograms[programId].uniqueLocations;
    delete processedPrograms[programId].terminals;
  }

  return {
    summary: {
      totalGpsPoints: gpsPoints.length,
      programsCount: Object.keys(processedPrograms).length,
      terminalsCount: terminalCount.size,
      dateRange: `${startDate} to ${endDate}`,
    },
    programs: processedPrograms,
  };
}

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
      .select("program_id, status, start_at, end_at")
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

    if (programIds.length === 0) {
      return res.json({
        client: { id: client.id, name: client.name, activePrograms: [] },
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
            dateRange: `${startDate} to ${endDate}`,
          },
          programs: {},
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
        heatmap: heatmapData || {
          summary: {
            totalGpsPoints: 0,
            programsCount: 0,
            terminalsCount: 0,
            dateRange: `${startDate} to ${endDate}`,
          },
          programs: {},
        },
        historical_terminals: allHistoricalTerminals,
      });
    }

    // 3) Fetch terminal metadata
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

    // Build output terminals list
    const terminalsOut = (playingRows || []).map((p) => {
      const meta = terminalMetaById[p.terminal_id] || {};
      const gps = latestGpsByTerminal[p.terminal_id] || null;
      return {
        terminalId: p.terminal_id,
        name: meta.name || null,
        group_name: meta.group_name || null,
        last_report_time: meta.last_report_time || null,
        power_status: meta.power_status || null,
        playing: {
          program_id: p.program_id,
          program_name: p.program_name,
          file_name: p.file_name,
          source: p.source,
          started_at: p.started_at,
        },
        gps: gps
          ? {
              longitude: gps.longitude,
              latitude: gps.latitude,
              last_updated: gps.inserted_at,
            }
          : null,
      };
    });

    const terminalsPlayingCount = terminalsOut.length;
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
    } catch (error) {
      console.warn("Failed to fetch historical terminals data:", error.message);
    }

    const response = {
      client: { id: client.id, name: client.name, activePrograms: programIds },
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
          dateRange: `${startDate} to ${endDate}`,
        },
        programs: {},
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
