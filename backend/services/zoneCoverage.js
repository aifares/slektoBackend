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
  endDate,
  zoneLimit = 50
) {
  if (
    !programIds ||
    programIds.length === 0 ||
    !terminalIds ||
    terminalIds.length === 0
  ) {
    return {};
  }

  const endDateOnly = endDate.split("T")[0];

  try {
    const { data, error } = await supabase.rpc("get_zone_coverage_topn", {
      p_program_ids: programIds,
      p_terminal_ids: terminalIds,
      p_start_date: startDate,
      p_end_date: endDateOnly,
      p_zone_limit: zoneLimit,
    });

    if (error) {
      console.error("Error from get_zone_coverage_topn:", error.message);
      throw new Error(
        `Failed to build zone coverage metrics: ${error.message}`
      );
    }

    if (!data || data.length === 0) {
      return {};
    }

    const zoneCoverageByProgram = {};

    for (const row of data) {
      const programId = row.program_id;
      if (!zoneCoverageByProgram[programId]) {
        zoneCoverageByProgram[programId] = {
          program_id: programId,
          program_name: row.program_name || null,
          total_zones_visited: 0,
          total_zones_available: row.total_zones_available || 0,
          coverage_percentage: 0,
          total_minutes_in_zones: 0,
          total_hours_in_zones: 0,
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
          time_zone_distribution: {
            morning: { minutes: 0, hours: 0, percentage: 0 },
            afternoon: { minutes: 0, hours: 0, percentage: 0 },
            evening: { minutes: 0, hours: 0, percentage: 0 },
            night: { minutes: 0, hours: 0, percentage: 0 },
            rush_hour: { minutes: 0, hours: 0, percentage: 0 },
          },
          date_range: { start: row.date_start, end: row.date_end },
        };
      }

      // Per-zone entry
      zoneCoverageByProgram[programId].zones.push({
        zone_id: row.zone_id,
        zone_name: row.zone_name,
        display_name: row.display_name,
        zone_type: row.zone_type,
        density_multiplier: Number(row.density_multiplier),
        minutes_spent: Number(row.total_minutes),
        hours_spent: Number(row.total_hours),
        weighted_exposure: Number(row.weighted_exposure),
        percentage_of_total_time: 0,
        time_breakdown: {
          morning: {
            minutes: Number(row.morning_minutes),
            hours: Math.round((Number(row.morning_minutes) / 60) * 100) / 100,
            percentage: 0,
          },
          afternoon: {
            minutes: Number(row.afternoon_minutes),
            hours: Math.round((Number(row.afternoon_minutes) / 60) * 100) / 100,
            percentage: 0,
          },
          evening: {
            minutes: Number(row.evening_minutes),
            hours: Math.round((Number(row.evening_minutes) / 60) * 100) / 100,
            percentage: 0,
          },
          night: {
            minutes: Number(row.night_minutes),
            hours: Math.round((Number(row.night_minutes) / 60) * 100) / 100,
            percentage: 0,
          },
          rush_hour: {
            minutes: Number(row.rush_hour_minutes),
            hours: Math.round((Number(row.rush_hour_minutes) / 60) * 100) / 100,
            percentage: 0,
          },
        },
      });

      // Totals
      zoneCoverageByProgram[programId].total_minutes_in_zones += Number(
        row.total_minutes
      );
      zoneCoverageByProgram[programId].total_hours_in_zones =
        Math.round(
          (zoneCoverageByProgram[programId].total_minutes_in_zones / 60) * 100
        ) / 100;
      zoneCoverageByProgram[programId].high_value_exposure_score += Number(
        row.weighted_exposure
      );

      // Zone type aggregation
      const typeKey = row.zone_type;
      if (zoneCoverageByProgram[programId].zone_type_distribution[typeKey]) {
        const ztd =
          zoneCoverageByProgram[programId].zone_type_distribution[typeKey];
        ztd.zones_count += 1;
        ztd.minutes += Number(row.total_minutes);
        ztd.hours = Math.round((ztd.minutes / 60) * 100) / 100;
      }

      // Time buckets aggregation
      const tzd = zoneCoverageByProgram[programId].time_zone_distribution;
      tzd.morning.minutes += Number(row.morning_minutes);
      tzd.afternoon.minutes += Number(row.afternoon_minutes);
      tzd.evening.minutes += Number(row.evening_minutes);
      tzd.night.minutes += Number(row.night_minutes);
      tzd.rush_hour.minutes += Number(row.rush_hour_minutes);
    }

    // Finalize per-program calculations
    for (const programId of Object.keys(zoneCoverageByProgram)) {
      const entry = zoneCoverageByProgram[programId];
      entry.total_zones_visited = entry.zones.length;
      entry.coverage_percentage =
        entry.total_zones_available > 0
          ? Math.round(
              (entry.total_zones_visited / entry.total_zones_available) * 1000
            ) / 10
          : 0;

      // Sort zones by weighted exposure desc
      entry.zones.sort((a, b) => b.weighted_exposure - a.weighted_exposure);

      // Percentage of total time per zone and time bucket percentages
      const totalTimeMinutes =
        entry.time_zone_distribution.morning.minutes +
        entry.time_zone_distribution.afternoon.minutes +
        entry.time_zone_distribution.evening.minutes +
        entry.time_zone_distribution.night.minutes;

      entry.zones.forEach((z) => {
        z.percentage_of_total_time =
          totalTimeMinutes > 0
            ? Math.round((z.minutes_spent / totalTimeMinutes) * 1000) / 10
            : 0;
      });

      for (const period of [
        "morning",
        "afternoon",
        "evening",
        "night",
        "rush_hour",
      ]) {
        const minutes = entry.time_zone_distribution[period].minutes;
        entry.time_zone_distribution[period].hours =
          Math.round((minutes / 60) * 100) / 100;
        entry.time_zone_distribution[period].percentage =
          totalTimeMinutes > 0
            ? Math.round((minutes / totalTimeMinutes) * 1000) / 10
            : 0;
        entry.time_zone_distribution[period].minutes =
          Math.round(minutes * 100) / 100;
      }

      // Round totals
      entry.total_minutes_in_zones =
        Math.round(entry.total_minutes_in_zones * 100) / 100;
      entry.high_value_exposure_score =
        Math.round(entry.high_value_exposure_score * 100) / 100;
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
