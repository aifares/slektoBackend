const { supabase } = require("../config/supabase");
const {
  getTimePeriod,
  isRushHour,
  splitMinutesAcrossPeriods,
} = require("../utils/timePeriod");

/**
 * Fetch all GPS points with pagination (handles >1000 records)
 * @param {Array<string>} terminalIds - Terminal IDs to fetch for
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDateOnly - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of GPS points
 */
async function fetchAllGpsPoints(terminalIds, startDate, endDateOnly) {
  const pageSize = 1000;
  let gpsPoints = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: batch, error: gpsError } = await supabase
      .from("terminal_gps_data")
      .select("id, terminal_id, zone_id, recorded_at, data_date")
      .in("terminal_id", terminalIds)
      .gte("data_date", startDate)
      .lte("data_date", endDateOnly)
      .not("zone_id", "is", null)
      .order("terminal_id", { ascending: true })
      .order("recorded_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (gpsError) {
      console.error(
        "Error fetching GPS points for zone coverage:",
        gpsError.message
      );
      throw new Error(`Failed to fetch GPS points: ${gpsError.message}`);
    }

    if (batch && batch.length > 0) {
      gpsPoints = gpsPoints.concat(batch);
      from += pageSize;
      hasMore = batch.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  return gpsPoints;
}

/**
 * Build time breakdown object from period minutes
 * @param {Object} breakdown - {morning, afternoon, evening, night, rush_hour} minutes
 * @returns {Object} Formatted time breakdown with minutes, hours, and percentages
 */
function buildTimeBreakdown(breakdown) {
  const breakdownTotal =
    breakdown.morning +
    breakdown.afternoon +
    breakdown.evening +
    breakdown.night;

  return {
    morning: {
      minutes: Math.round(breakdown.morning * 100) / 100,
      hours: Math.round((breakdown.morning / 60) * 100) / 100,
      percentage:
        breakdownTotal > 0
          ? Math.round((breakdown.morning / breakdownTotal) * 1000) / 10
          : 0,
    },
    afternoon: {
      minutes: Math.round(breakdown.afternoon * 100) / 100,
      hours: Math.round((breakdown.afternoon / 60) * 100) / 100,
      percentage:
        breakdownTotal > 0
          ? Math.round((breakdown.afternoon / breakdownTotal) * 1000) / 10
          : 0,
    },
    evening: {
      minutes: Math.round(breakdown.evening * 100) / 100,
      hours: Math.round((breakdown.evening / 60) * 100) / 100,
      percentage:
        breakdownTotal > 0
          ? Math.round((breakdown.evening / breakdownTotal) * 1000) / 10
          : 0,
    },
    night: {
      minutes: Math.round(breakdown.night * 100) / 100,
      hours: Math.round((breakdown.night / 60) * 100) / 100,
      percentage:
        breakdownTotal > 0
          ? Math.round((breakdown.night / breakdownTotal) * 1000) / 10
          : 0,
    },
    rush_hour: {
      minutes: Math.round((breakdown.rush_hour || 0) * 100) / 100,
      hours: Math.round(((breakdown.rush_hour || 0) / 60) * 100) / 100,
      percentage:
        breakdownTotal > 0
          ? Math.round(((breakdown.rush_hour || 0) / breakdownTotal) * 1000) /
            10
          : 0,
    },
  };
}

/**
 * Process GPS points for a program and build zone time breakdown
 * @param {Array} gpsPoints - All GPS points
 * @param {Array} programSessions - Playing sessions for this program
 * @returns {Map} Map of zone_id -> {total, morning, afternoon, evening, night}
 */
function processGpsPointsForProgram(gpsPoints, programSessions) {
  // Helper function to check if a GPS point was during THIS program's playing session
  const isPointDuringProgramPlaying = (terminalId, timestamp) => {
    const pointTime = new Date(timestamp);
    return programSessions.some((session) => {
      if (session.terminal_id !== terminalId) return false;
      const startTime = new Date(session.started_at);
      const endTime = session.ended_at
        ? new Date(session.ended_at)
        : new Date();
      return pointTime >= startTime && pointTime <= endTime;
    });
  };

  // zone_id -> {total, morning, afternoon, evening, night, rush_hour}
  const zoneTimeBreakdown = new Map();
  const lastPointByTerminal = new Map(); // terminal_id -> {zone_id, timestamp}

  // Initialize zone breakdown helper
  const getOrInitZoneBreakdown = (zoneId) => {
    if (!zoneTimeBreakdown.has(zoneId)) {
      zoneTimeBreakdown.set(zoneId, {
        total: 0,
        morning: 0,
        afternoon: 0,
        evening: 0,
        night: 0,
        rush_hour: 0,
      });
    }
    return zoneTimeBreakdown.get(zoneId);
  };

  // Helper to add minutes to a period in a zone
  const addMinutesToPeriod = (zoneId, period, minutes, addToTotal = true) => {
    const breakdown = getOrInitZoneBreakdown(zoneId);
    if (addToTotal) {
      breakdown.total += minutes;
    }
    breakdown[period] += minutes;
  };

  // Process GPS points for this program
  for (const point of gpsPoints) {
    const isActive = isPointDuringProgramPlaying(
      point.terminal_id,
      point.recorded_at
    );

    if (isActive) {
      const lastPoint = lastPointByTerminal.get(point.terminal_id);

      if (lastPoint && lastPoint.zone_id === point.zone_id) {
        // Same zone - calculate duration since last point
        const timeDiff =
          new Date(point.recorded_at) - new Date(lastPoint.timestamp);
        const minutesDiff = timeDiff / (1000 * 60);

        // Only count if time difference is reasonable (< 30 minutes)
        if (minutesDiff > 0 && minutesDiff <= 30) {
          // Split minutes across periods if spanning boundaries
          const periodSplit = splitMinutesAcrossPeriods(
            lastPoint.timestamp,
            point.recorded_at,
            minutesDiff
          );

          // Add minutes to each period
          addMinutesToPeriod(point.zone_id, "morning", periodSplit.morning);
          addMinutesToPeriod(point.zone_id, "afternoon", periodSplit.afternoon);
          addMinutesToPeriod(point.zone_id, "evening", periodSplit.evening);
          addMinutesToPeriod(point.zone_id, "night", periodSplit.night);
          // Add rush hour minutes separately (don't add to total - already counted in morning/evening)
          addMinutesToPeriod(
            point.zone_id,
            "rush_hour",
            periodSplit.rush_hour || 0,
            false
          );
        } else if (minutesDiff > 30) {
          // Gap > 30 minutes - treat as new entry point in zone
          // Add 1 minute for presence at this point
          const period = getTimePeriod(point.recorded_at);
          addMinutesToPeriod(point.zone_id, period, 1);
          // Also count towards rush hour if during rush hour (don't add to total - already counted)
          if (isRushHour(point.recorded_at)) {
            addMinutesToPeriod(point.zone_id, "rush_hour", 1, false);
          }
        }
      } else if (lastPoint && lastPoint.zone_id !== point.zone_id) {
        // Zone changed - add 1 minute for presence in new zone
        const period = getTimePeriod(point.recorded_at);
        addMinutesToPeriod(point.zone_id, period, 1);
        // Also count towards rush hour if during rush hour
        if (isRushHour(point.recorded_at)) {
          addMinutesToPeriod(point.zone_id, "rush_hour", 1);
        }
      } else {
        // First point for this terminal - count 1 minute of presence
        const period = getTimePeriod(point.recorded_at);
        addMinutesToPeriod(point.zone_id, period, 1);
        // Also count towards rush hour if during rush hour
        if (isRushHour(point.recorded_at)) {
          addMinutesToPeriod(point.zone_id, "rush_hour", 1);
        }
      }

      // Update last point tracker
      lastPointByTerminal.set(point.terminal_id, {
        zone_id: point.zone_id,
        timestamp: point.recorded_at,
      });
    }
  }

  return zoneTimeBreakdown;
}

/**
 * Build zone coverage metrics for a client's campaign, grouped by program
 * Shows which NYC neighborhoods were reached, time spent in each zone,
 * and high-value zone exposure per program
 *
 * @param {Array<number>} programIds - Client's active program IDs
 * @param {Array<string>} terminalIds - Terminal IDs playing these programs
 * @param {string} startDate - Campaign start date (YYYY-MM-DD)
 * @param {string} endDate - Campaign end date (YYYY-MM-DD or ISO timestamp)
 * @returns {Object} Zone coverage metrics keyed by program_id
 */
async function buildZoneCoverageMetrics(
  programIds,
  terminalIds,
  startDate,
  endDate
) {
  // Return empty object if no programs or terminals
  if (
    !programIds ||
    programIds.length === 0 ||
    !terminalIds ||
    terminalIds.length === 0
  ) {
    return {};
  }

  // Convert endDate to date format if it's a full ISO timestamp
  const endDateOnly = endDate.split("T")[0];

  try {
    // 1. Get all GPS points with zone information for the campaign period
    const gpsPoints = await fetchAllGpsPoints(
      terminalIds,
      startDate,
      endDateOnly
    );

    // If no GPS points with zones, return empty object
    if (!gpsPoints || gpsPoints.length === 0) {
      return {};
    }

    // 2. Get playing sessions to filter only active ad time
    const { data: playingSessions, error: playingError } = await supabase
      .from("playing")
      .select("terminal_id, program_id, program_name, started_at, ended_at")
      .in("terminal_id", terminalIds)
      .in("program_id", programIds)
      .gte("started_at", `${startDate}T00:00:00`)
      .order("terminal_id", { ascending: true })
      .order("started_at", { ascending: true });

    if (playingError) {
      console.error("Error fetching playing sessions:", playingError.message);
      throw new Error(
        `Failed to fetch playing sessions: ${playingError.message}`
      );
    }

    if (!playingSessions || playingSessions.length === 0) {
      return {};
    }

    // 3. Get all zone information
    const { data: allZones, error: zonesError } = await supabase
      .from("nyc_zones")
      .select("id, name, display_name, zone_type, density_multiplier");

    if (zonesError) {
      console.error("Error fetching zones:", zonesError.message);
      throw new Error(`Failed to fetch zones: ${zonesError.message}`);
    }

    // Create a map of zone_id to zone info
    const zoneMap = new Map();
    allZones.forEach((zone) => {
      zoneMap.set(zone.id, zone);
    });

    // 4. Group playing sessions by program
    const sessionsByProgram = new Map();
    const programNames = new Map();

    for (const session of playingSessions) {
      if (!sessionsByProgram.has(session.program_id)) {
        sessionsByProgram.set(session.program_id, []);
        programNames.set(session.program_id, session.program_name);
      }
      sessionsByProgram.get(session.program_id).push(session);
    }

    // 5. Build zone coverage for each program
    const zoneCoverageByProgram = {};

    for (const [programId, programSessions] of sessionsByProgram.entries()) {
      // Process GPS points and build zone time breakdown
      const zoneTimeBreakdown = processGpsPointsForProgram(
        gpsPoints,
        programSessions
      );

      // Build zone metrics for this program
      const zones = [];
      let totalMinutes = 0;
      let totalWeightedExposure = 0;

      const zoneTypeStats = {
        tourist: { zones: new Set(), minutes: 0 },
        shopping: { zones: new Set(), minutes: 0 },
        residential: { zones: new Set(), minutes: 0 },
        mixed: { zones: new Set(), minutes: 0 },
      };

      for (const [zoneId, breakdown] of zoneTimeBreakdown.entries()) {
        const zoneInfo = zoneMap.get(zoneId);
        if (!zoneInfo) continue;

        const minutes = breakdown.total;
        const hours = minutes / 60;
        const weightedExposure = minutes * zoneInfo.density_multiplier;
        const timeBreakdown = buildTimeBreakdown(breakdown);

        zones.push({
          zone_id: zoneId,
          zone_name: zoneInfo.name,
          display_name: zoneInfo.display_name,
          zone_type: zoneInfo.zone_type,
          density_multiplier: Number(zoneInfo.density_multiplier),
          minutes_spent: Math.round(minutes * 100) / 100,
          hours_spent: Math.round(hours * 100) / 100,
          weighted_exposure: Math.round(weightedExposure * 100) / 100,
          percentage_of_total_time: 0, // Will calculate after we have total
          time_breakdown: timeBreakdown,
        });

        totalMinutes += minutes;
        totalWeightedExposure += weightedExposure;

        // Track zone type stats
        if (zoneTypeStats[zoneInfo.zone_type]) {
          zoneTypeStats[zoneInfo.zone_type].zones.add(zoneId);
          zoneTypeStats[zoneInfo.zone_type].minutes += minutes;
        }
      }

      // Skip this program if no zones were visited
      if (zones.length === 0) {
        continue;
      }

      // Calculate percentages now that we have total
      zones.forEach((zone) => {
        zone.percentage_of_total_time =
          totalMinutes > 0
            ? Math.round((zone.minutes_spent / totalMinutes) * 1000) / 10
            : 0;
      });

      // Sort zones by minutes spent (descending)
      zones.sort((a, b) => b.minutes_spent - a.minutes_spent);

      // Build zone type distribution
      const zoneTypeDistribution = {};
      for (const [type, stats] of Object.entries(zoneTypeStats)) {
        const hours = stats.minutes / 60;
        const percentage =
          totalMinutes > 0
            ? Math.round((stats.minutes / totalMinutes) * 1000) / 10
            : 0;

        zoneTypeDistribution[type] = {
          zones_count: stats.zones.size,
          minutes: Math.round(stats.minutes * 100) / 100,
          hours: Math.round(hours * 100) / 100,
          percentage: percentage,
        };
      }

      // Build time zone distribution - aggregate time breakdown across all zones
      const timeZoneDistribution = {
        morning: { minutes: 0, hours: 0, percentage: 0 },
        afternoon: { minutes: 0, hours: 0, percentage: 0 },
        evening: { minutes: 0, hours: 0, percentage: 0 },
        night: { minutes: 0, hours: 0, percentage: 0 },
        rush_hour: { minutes: 0, hours: 0, percentage: 0 },
      };

      // Aggregate time breakdown from all zones
      for (const zone of zones) {
        if (zone.time_breakdown) {
          timeZoneDistribution.morning.minutes +=
            zone.time_breakdown.morning.minutes;
          timeZoneDistribution.afternoon.minutes +=
            zone.time_breakdown.afternoon.minutes;
          timeZoneDistribution.evening.minutes +=
            zone.time_breakdown.evening.minutes;
          timeZoneDistribution.night.minutes +=
            zone.time_breakdown.night.minutes;
          timeZoneDistribution.rush_hour.minutes +=
            zone.time_breakdown.rush_hour.minutes;
        }
      }

      // Calculate hours and percentages for time zone distribution
      const totalTimeMinutes =
        timeZoneDistribution.morning.minutes +
        timeZoneDistribution.afternoon.minutes +
        timeZoneDistribution.evening.minutes +
        timeZoneDistribution.night.minutes;

      for (const period of [
        "morning",
        "afternoon",
        "evening",
        "night",
        "rush_hour",
      ]) {
        const minutes = timeZoneDistribution[period].minutes;
        timeZoneDistribution[period].hours =
          Math.round((minutes / 60) * 100) / 100;
        timeZoneDistribution[period].percentage =
          totalTimeMinutes > 0
            ? Math.round((minutes / totalTimeMinutes) * 1000) / 10
            : 0;
        timeZoneDistribution[period].minutes = Math.round(minutes * 100) / 100;
      }

      // Calculate coverage percentage
      const coveragePercentage =
        allZones.length > 0
          ? Math.round((zones.length / allZones.length) * 1000) / 10
          : 0;

      // Store zone coverage for this program
      zoneCoverageByProgram[programId] = {
        program_id: programId,
        program_name: programNames.get(programId),
        total_zones_visited: zones.length,
        total_zones_available: allZones.length,
        coverage_percentage: coveragePercentage,
        total_minutes_in_zones: Math.round(totalMinutes * 100) / 100,
        total_hours_in_zones: Math.round((totalMinutes / 60) * 100) / 100,
        high_value_exposure_score:
          Math.round(totalWeightedExposure * 100) / 100,
        zones: zones,
        zone_type_distribution: zoneTypeDistribution,
        time_zone_distribution: timeZoneDistribution,
        date_range: {
          start: startDate,
          end: endDateOnly,
        },
      };
    }

    return zoneCoverageByProgram;
  } catch (error) {
    console.error("Error building zone coverage metrics:", error.message);
    throw error;
  }
}

module.exports = {
  buildZoneCoverageMetrics,
};
