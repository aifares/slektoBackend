const { supabase } = require("../config/supabase");

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in miles
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth's radius in miles
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

/**
 * Get time of day bucket for a given timestamp
 * @param {Date} timestamp - The timestamp to categorize
 * @returns {string} Time bucket name
 */
function getTimeOfDayBucket(timestamp) {
  // Convert UTC timestamp to Eastern Time (America/New_York)
  const etString = timestamp.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
  });
  const hour = parseInt(etString);

  if (hour >= 0 && hour < 7) return "earlyMorning"; // 12am-7am ET
  if (hour >= 7 && hour < 9) return "morningRush"; // 7am-9am ET
  if (hour >= 9 && hour < 16) return "midday"; // 9am-4pm ET
  if (hour >= 16 && hour < 19) return "eveningRush"; // 4pm-7pm ET
  return "evening"; // 7pm-12am ET
}

async function buildGpsHeatmapData(
  clientId,
  programIds,
  terminalIds,
  startDate,
  endDate,
  filterProgramId,
  campaignPrograms = null // Array of {program_id, campaign_start_at} objects
) {
  const targetProgramIds = filterProgramId
    ? [parseInt(filterProgramId)]
    : programIds;

  if (targetProgramIds.length === 0) {
    return null;
  }

  // Extract date-only parts for data_date filtering (which is a DATE column)
  const startDateOnly = startDate.split("T")[0];
  const endDateOnly = endDate.split("T")[0];

  let gpsPoints = [];
  let playingSessions = [];

  // Try to use RPC for efficient campaign-filtered GPS data
  if (campaignPrograms && campaignPrograms.length > 0 && clientId) {
    try {
      // Build JSONB array for RPC
      const campaignProgramsJsonb = campaignPrograms.map((cp) => ({
        program_id: cp.program_id,
        campaign_start_at: cp.campaign_start_at,
      }));

      const { data: rpcGpsData, error: rpcError } = await supabase.rpc(
        "get_campaign_heatmap_gps",
        {
          p_client_id: clientId,
          p_campaign_programs: campaignProgramsJsonb,
          p_end_date: endDate,
          p_terminal_ids:
            terminalIds && terminalIds.length > 0 ? terminalIds : null,
        }
      );

      if (!rpcError && rpcGpsData !== null) {
        // RPC succeeded (even if empty - that's valid, means no matching GPS points)
        console.log(
          `✅ [Heatmap] Using RPC: ${rpcGpsData.length} GPS points filtered by campaign start dates`
        );

        if (rpcGpsData.length > 0) {
          // Transform RPC data to match expected format
          gpsPoints = rpcGpsData.map((point) => ({
            terminal_id: point.terminal_id,
            longitude: point.longitude,
            latitude: point.latitude,
            inserted_at: point.inserted_at || point.recorded_at,
            program_id: point.program_id,
            program_name: point.program_name,
          }));

          // Group by program_id to create playing sessions lookup
          const sessionsByProgram = {};
          rpcGpsData.forEach((point) => {
            if (!sessionsByProgram[point.program_id]) {
              sessionsByProgram[point.program_id] = {
                program_id: point.program_id,
                program_name: point.program_name,
              };
            }
          });

          // Create minimal playing sessions structure for compatibility
          // The RPC already filtered and matched, so we just need program info
          playingSessions = Object.values(sessionsByProgram);
        } else {
          // Empty result is valid - no GPS points match the campaign criteria
          // Set empty arrays to skip fallback
          gpsPoints = [];
          playingSessions = [];
        }
      } else {
        console.warn(
          `⚠️  [Heatmap] RPC error, using fallback:`,
          rpcError?.message
        );
        throw new Error("RPC fallback"); // Trigger fallback
      }
    } catch (rpcErr) {
      // Fall through to fallback method
      console.log(
        `ℹ️  [Heatmap] Using fallback method (RPC unavailable or failed)`
      );
    }
  }

  // Fallback to original method if RPC not used or failed
  if (gpsPoints.length === 0) {
    const { data: gpsData, error: gpsError } = await supabase
      .from("terminal_gps_data")
      .select("terminal_id, longitude, latitude, inserted_at")
      .in("terminal_id", terminalIds)
      .gte("data_date", startDateOnly)
      .lte("data_date", endDateOnly)
      .order("inserted_at", { ascending: true })
      .limit(5000);

    if (gpsError) {
      throw new Error(`Failed to fetch GPS points: ${gpsError.message}`);
    }

    gpsPoints = gpsData || [];

    if (gpsPoints.length === 0) {
      return {
        summary: {
          totalGpsPoints: 0,
          programsCount: 0,
          terminalsCount: 0,
          distanceMiles: 0,
          dateRange: `${startDateOnly} to ${endDateOnly}`,
        },
        programs: {},
      };
    }

    const { data: playingData, error: playingError } = await supabase
      .from("playing")
      .select(
        "terminal_id, program_id, program_name, started_at, ended_at, status"
      )
      .in("terminal_id", terminalIds)
      .in("program_id", targetProgramIds)
      .gte("started_at", startDate) // Use full timestamp
      .lte("started_at", endDate) // Use full timestamp
      .order("started_at", { ascending: true });

    if (playingError) {
      throw new Error(
        `Failed to fetch playing sessions: ${playingError.message}`
      );
    }

    playingSessions = playingData || [];
  }

  const programHeatmapData = {};
  const terminalCount = new Set();

  // Track last point per terminal for distance calculation
  const lastPointByTerminal = {};

  // Check if we're using RPC data (points already have program_id)
  const usingRpcData =
    gpsPoints.length > 0 && gpsPoints[0].program_id !== undefined;

  for (const gpsPoint of gpsPoints) {
    const gpsTime = new Date(gpsPoint.inserted_at);

    let session = null;
    let programId = null;
    let programName = null;

    if (usingRpcData) {
      // RPC already matched GPS to sessions - use program_id from GPS point
      programId = gpsPoint.program_id?.toString();
      programName = gpsPoint.program_name;
      session = {
        program_id: gpsPoint.program_id,
        program_name: gpsPoint.program_name,
      }; // Dummy session for compatibility
    } else {
      // Fallback: Match GPS points to playing sessions manually
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

      session = activeSession || completedSession;
      if (session) {
        programId = session.program_id.toString();
        programName = session.program_name;
      }
    }

    if (session && programId) {
      if (!programHeatmapData[programId]) {
        programHeatmapData[programId] = {
          program_id: parseInt(programId),
          program_name: programName,
          points: [],
          totalPoints: 0,
          uniqueLocations: new Set(),
          terminals: new Set(),
          distanceMiles: 0,
          timeDistribution: {
            earlyMorning: { miles: 0, durationMinutes: 0 }, // 12am-7am
            morningRush: { miles: 0, durationMinutes: 0 }, // 7am-9am
            midday: { miles: 0, durationMinutes: 0 }, // 9am-4pm
            eveningRush: { miles: 0, durationMinutes: 0 }, // 4pm-7pm
            evening: { miles: 0, durationMinutes: 0 }, // 7pm-12am
          },
        };
      }

      // Check if this point should be included based on speed filter
      const terminalKey = `${programId}_${gpsPoint.terminal_id}`;
      let includePoint = true;
      let segmentBreak = false;

      if (lastPointByTerminal[terminalKey]) {
        const lastPoint = lastPointByTerminal[terminalKey];
        const timeDiffHours =
          (gpsTime - lastPoint.timestamp) / (1000 * 60 * 60);

        // Check for time jump or speed violation
        if (timeDiffHours >= 12 || timeDiffHours <= 0) {
          segmentBreak = true;
        } else {
          const distanceMiles = haversineDistance(
            lastPoint.latitude,
            lastPoint.longitude,
            gpsPoint.latitude,
            gpsPoint.longitude
          );

          // Calculate speed in mph
          const speedMph = distanceMiles / timeDiffHours;

          // Maximum reasonable speed threshold (80 mph)
          const maxSpeedMph = 80;

          if (speedMph <= maxSpeedMph) {
            programHeatmapData[programId].distanceMiles += distanceMiles;

            // Track time distribution - add distance and duration to appropriate time bucket
            const timeBucket = getTimeOfDayBucket(gpsTime);
            const durationMinutes = timeDiffHours * 60;

            programHeatmapData[programId].timeDistribution[timeBucket].miles +=
              distanceMiles;
            programHeatmapData[programId].timeDistribution[
              timeBucket
            ].durationMinutes += durationMinutes;
          } else {
            // Speed violation - mark as segment break
            segmentBreak = true;
          }
        }
      }

      // Add point with segment break flag
      programHeatmapData[programId].points.push({
        latitude: gpsPoint.latitude,
        longitude: gpsPoint.longitude,
        timestamp: gpsPoint.inserted_at,
        terminal_id: gpsPoint.terminal_id,
        intensity: 1.0,
        segment_break: segmentBreak, // Indicates frontend should not draw line from previous point
      });

      programHeatmapData[programId].totalPoints++;
      programHeatmapData[programId].uniqueLocations.add(
        `${gpsPoint.latitude},${gpsPoint.longitude}`
      );
      programHeatmapData[programId].terminals.add(gpsPoint.terminal_id);
      terminalCount.add(gpsPoint.terminal_id);

      lastPointByTerminal[terminalKey] = {
        latitude: gpsPoint.latitude,
        longitude: gpsPoint.longitude,
        timestamp: gpsTime,
      };
    }
  }

  const processedPrograms = [];
  let totalDistanceMiles = 0;

  for (const [programId, data] of Object.entries(programHeatmapData)) {
    if (data.points.length === 0) continue;

    const lats = data.points.map((p) => p.latitude);
    const lngs = data.points.map((p) => p.longitude);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    totalDistanceMiles += data.distanceMiles;

    // Calculate total duration for percentage calculation
    const totalDuration =
      data.timeDistribution.earlyMorning.durationMinutes +
      data.timeDistribution.morningRush.durationMinutes +
      data.timeDistribution.midday.durationMinutes +
      data.timeDistribution.eveningRush.durationMinutes +
      data.timeDistribution.evening.durationMinutes;

    // Format time distribution with percentages based on time
    const timeDistribution = {
      earlyMorning: {
        hours: "12am-7am",
        miles: Math.round(data.timeDistribution.earlyMorning.miles * 100) / 100,
        durationMinutes: Math.round(
          data.timeDistribution.earlyMorning.durationMinutes
        ),
        percentage:
          totalDuration > 0
            ? Math.round(
                (data.timeDistribution.earlyMorning.durationMinutes /
                  totalDuration) *
                  100 *
                  10
              ) / 10
            : 0,
      },
      morningRush: {
        hours: "7am-9am",
        miles: Math.round(data.timeDistribution.morningRush.miles * 100) / 100,
        durationMinutes: Math.round(
          data.timeDistribution.morningRush.durationMinutes
        ),
        percentage:
          totalDuration > 0
            ? Math.round(
                (data.timeDistribution.morningRush.durationMinutes /
                  totalDuration) *
                  100 *
                  10
              ) / 10
            : 0,
      },
      midday: {
        hours: "9am-4pm",
        miles: Math.round(data.timeDistribution.midday.miles * 100) / 100,
        durationMinutes: Math.round(
          data.timeDistribution.midday.durationMinutes
        ),
        percentage:
          totalDuration > 0
            ? Math.round(
                (data.timeDistribution.midday.durationMinutes / totalDuration) *
                  100 *
                  10
              ) / 10
            : 0,
      },
      eveningRush: {
        hours: "4pm-7pm",
        miles: Math.round(data.timeDistribution.eveningRush.miles * 100) / 100,
        durationMinutes: Math.round(
          data.timeDistribution.eveningRush.durationMinutes
        ),
        percentage:
          totalDuration > 0
            ? Math.round(
                (data.timeDistribution.eveningRush.durationMinutes /
                  totalDuration) *
                  100 *
                  10
              ) / 10
            : 0,
      },
      evening: {
        hours: "7pm-12am",
        miles: Math.round(data.timeDistribution.evening.miles * 100) / 100,
        durationMinutes: Math.round(
          data.timeDistribution.evening.durationMinutes
        ),
        percentage:
          totalDuration > 0
            ? Math.round(
                (data.timeDistribution.evening.durationMinutes /
                  totalDuration) *
                  100 *
                  10
              ) / 10
            : 0,
      },
    };

    processedPrograms.push({
      program_id: parseInt(programId),
      program_name: data.program_name,
      ...data,
      distanceMiles: Math.round(data.distanceMiles * 100) / 100, // Round to 2 decimals
      timeDistribution,
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

  return {
    summary: {
      totalGpsPoints: totalUsedPoints,
      programsCount: processedPrograms.length,
      terminalsCount: terminalCount.size,
      distanceMiles: Math.round(totalDistanceMiles * 100) / 100,
      dateRange: `${startDateOnly} to ${endDateOnly}`,
    },
    programs: processedPrograms,
  };
}

module.exports = { buildGpsHeatmapData };
