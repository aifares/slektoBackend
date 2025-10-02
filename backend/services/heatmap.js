const { supabase } = require("../config/supabase");

async function buildGpsHeatmapData(
  clientId,
  programIds,
  terminalIds,
  startDate,
  endDate,
  filterProgramId
) {
  const targetProgramIds = filterProgramId
    ? [parseInt(filterProgramId)]
    : programIds;

  if (targetProgramIds.length === 0) {
    return null;
  }

  const { data: gpsPoints, error: gpsError } = await supabase
    .from("terminal_gps_data")
    .select("terminal_id, longitude, latitude, inserted_at")
    .in("terminal_id", terminalIds)
    .gte("data_date", startDate)
    .lte("data_date", endDate)
    .order("inserted_at", { ascending: true })
    .limit(5000);

  if (gpsError) {
    throw new Error(`Failed to fetch GPS points: ${gpsError.message}`);
  }

  if (!gpsPoints || gpsPoints.length === 0) {
    return {
      summary: { totalGpsPoints: 0, programsCount: 0, terminalsCount: 0 },
      programs: {},
    };
  }

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

  const programHeatmapData = {};
  const terminalCount = new Set();

  for (const gpsPoint of gpsPoints) {
    const gpsTime = new Date(gpsPoint.inserted_at);

    const activeSession = playingSessions?.find(
      (session) =>
        session.terminal_id === gpsPoint.terminal_id &&
        session.status === "current" &&
        new Date(session.started_at) <= gpsTime &&
        (!session.ended_at || new Date(session.ended_at) >= gpsTime)
    );

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

module.exports = { buildGpsHeatmapData };
