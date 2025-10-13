const { supabase } = require("../config/supabase");

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in kilometers
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
}

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
      summary: {
        totalGpsPoints: 0,
        programsCount: 0,
        terminalsCount: 0,
        totalDistanceKm: 0,
        totalDistanceMiles: 0,
        dateRange: `${startDate} to ${endDate}`,
      },
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

  // Track last point per terminal for distance calculation
  const lastPointByTerminal = {};

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
          distanceKm: 0,
          distanceMiles: 0,
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

      // Calculate distance from previous point for this terminal
      const terminalKey = `${programId}_${gpsPoint.terminal_id}`;
      if (lastPointByTerminal[terminalKey]) {
        const lastPoint = lastPointByTerminal[terminalKey];
        const distance = haversineDistance(
          lastPoint.latitude,
          lastPoint.longitude,
          gpsPoint.latitude,
          gpsPoint.longitude
        );
        programHeatmapData[programId].distanceKm += distance;
      }

      lastPointByTerminal[terminalKey] = {
        latitude: gpsPoint.latitude,
        longitude: gpsPoint.longitude,
      };
    }
  }

  const processedPrograms = [];
  let totalDistanceKm = 0;

  for (const [programId, data] of Object.entries(programHeatmapData)) {
    if (data.points.length === 0) continue;

    const lats = data.points.map((p) => p.latitude);
    const lngs = data.points.map((p) => p.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // Convert kilometers to miles (1 km = 0.621371 miles)
    const distanceMiles = data.distanceKm * 0.621371;

    totalDistanceKm += data.distanceKm;

    processedPrograms.push({
      program_id: parseInt(programId),
      program_name: data.program_name,
      ...data,
      distanceKm: Math.round(data.distanceKm * 100) / 100, // Round to 2 decimals
      distanceMiles: Math.round(distanceMiles * 100) / 100, // Round to 2 decimals
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
    });
  }

  // Calculate total points that were actually used (during playing sessions)
  const totalUsedPoints = processedPrograms.reduce(
    (sum, program) => sum + program.totalPoints,
    0
  );

  const totalDistanceMiles = totalDistanceKm * 0.621371;

  return {
    summary: {
      totalGpsPoints: totalUsedPoints,
      programsCount: processedPrograms.length,
      terminalsCount: terminalCount.size,
      totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
      totalDistanceMiles: Math.round(totalDistanceMiles * 100) / 100,
      dateRange: `${startDate} to ${endDate}`,
    },
    programs: processedPrograms,
  };
}

module.exports = { buildGpsHeatmapData };
