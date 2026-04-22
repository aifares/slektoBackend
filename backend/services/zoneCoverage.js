const { supabase } = require("../config/supabase");
const {
  getTimePeriod,
  isRushHour,
  splitMinutesAcrossPeriods,
} = require("../utils/timePeriod");
const { getCurrentShare } = require("./shareOfVoiceSnapshots");
const {
  calculateEnhancedExposure,
  calculateAggregateDemographics,
} = require("./exposureScoring");

/**
 * Get share of voice for a program and client over a date range
 * Uses RPC function for efficient time-weighted calculation from snapshots
 * Falls back to current share if no snapshots exist
 *
 * @param {number} programId - Program ID
 * @param {number} clientId - Client ID
 * @param {string} startDate - Start date (ISO string)
 * @param {string} endDate - End date (ISO string)
 * @returns {Promise<number>} Share percentage as decimal (0-1)
 */
async function getShareForDateRange(programId, clientId, startDate, endDate) {
  try {
    // Use RPC function for efficient database-side calculation
    const { data, error } = await supabase.rpc("get_time_weighted_share", {
      p_program_id: programId,
      p_client_id: clientId,
      p_start_date: startDate,
      p_end_date: endDate,
    });

    if (error) {
      console.warn(
        `⚠️  RPC error getting time-weighted share for program ${programId}, client ${clientId}:`,
        error.message
      );
      // Fall through to fallback
    } else if (data !== null && data !== undefined) {
      // RPC returns percentage (0-100), convert to decimal (0-1)
      const shareDecimal = parseFloat(data) / 100;
      if (shareDecimal >= 0 && shareDecimal <= 1) {
        return shareDecimal;
      }
    }

    // Fallback to current share if RPC returns null or no snapshots exist
    const currentShare = await getCurrentShare(programId, clientId);
    return currentShare / 100; // Convert from percentage to decimal
  } catch (error) {
    console.error(
      `❌ Error in getShareForDateRange for program ${programId}, client ${clientId}:`,
      error.message
    );
    // Fallback to current share on error
    const currentShare = await getCurrentShare(programId, clientId);
    return currentShare / 100;
  }
}

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
 * Calculate Share of Voice for zone coverage
 * Reuses the same logic as campaign metrics but using files table
 */
async function getShareOfVoiceForZones(programIds) {
  try {
    const { data, error } = await supabase
      .from("files")
      .select("program_id, client_id")
      .in("program_id", programIds)
      .is("removed_at", null); // Only count files that haven't been removed

    if (error) {
      console.error(
        "[Zone Coverage] Error querying share of voice:",
        error.message
      );
      return {};
    }

    const shareByProgram = {};
    const programGroups = {};

    for (const row of data || []) {
      const programId = row.program_id;
      if (!programGroups[programId]) {
        programGroups[programId] = [];
      }
      if (row.client_id) {
        programGroups[programId].push(row.client_id);
      }
    }

    for (const [programId, clientIds] of Object.entries(programGroups)) {
      const totalCount = clientIds.length;
      const clientCounts = {};

      for (const clientId of clientIds) {
        clientCounts[clientId] = (clientCounts[clientId] || 0) + 1;
      }

      shareByProgram[programId] = {};
      for (const [clientId, count] of Object.entries(clientCounts)) {
        shareByProgram[programId][clientId] = count / totalCount;
      }
    }

    return shareByProgram;
  } catch (error) {
    console.error("[Zone Coverage] Error calculating share:", error.message);
    return {};
  }
}

/**
 * Build zone coverage metrics for a client's campaign, grouped by program
 * Shows which NYC neighborhoods were reached, time spent in each zone,
 * and high-value zone exposure per program
 * Applies Share of Voice calculation for shared programs
 *
 * @param {Array<number>} programIds - Client's active program IDs
 * @param {Array<string>} terminalIds - Terminal IDs playing these programs
 * @param {string} startDate - Campaign start date (YYYY-MM-DD)
 * @param {string} endDate - Campaign end date (YYYY-MM-DD or ISO timestamp)
 * @param {number} zoneLimit - Max zones to return per program
 * @param {string} clientId - Client ID for share of voice calculation (optional)
 * @returns {Object} Zone coverage metrics keyed by program_id
 */
async function buildZoneCoverageMetrics(
  programIds,
  terminalIds,
  startDate,
  endDate,
  zoneLimit = 50,
  clientId = null
) {
  if (
    !programIds ||
    programIds.length === 0 ||
    !terminalIds ||
    terminalIds.length === 0
  ) {
    return {};
  }

  // Share of Voice will be calculated per program with date ranges using RPC

  try {
    // Use demographics-enhanced RPC for zone coverage with demographic data
    const { data, error } = await supabase.rpc("get_zone_coverage_with_demographics", {
      p_program_ids: programIds,
      p_terminal_ids: terminalIds,
      p_start_date: startDate,
      p_end_date: endDate,
      p_zone_limit: zoneLimit,
    });

    if (error) {
      console.error("Error from get_zone_coverage_with_demographics:", error.message);
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
          date_range: { start: startDate, end: endDate },
        };
      }

      // Calculate enhanced exposure with demographics
      const enhancedData = calculateEnhancedExposure({
        weighted_exposure: row.weighted_exposure,
        residential_demographics: row.residential_demographics,
        workforce_demographics: row.workforce_demographics,
        tourist_demographics: row.tourist_demographics,
        time_period_breakdown: row.time_period_breakdown,
      });

      // Per-zone entry with demographics
      zoneCoverageByProgram[programId].zones.push({
        zone_id: row.zone_id,
        zone_name: row.zone_name,
        display_name: row.display_name,
        zone_type: row.zone_type,
        density_multiplier: Number(row.density_multiplier),
        minutes_spent: Number(row.total_minutes),
        hours_spent: Number(row.total_hours),
        weighted_exposure: Number(row.weighted_exposure),
        // NEW: Demographics-enhanced exposure
        demographics_enhanced_exposure: enhancedData.demographics_enhanced_exposure,
        demographic_value_multiplier: enhancedData.demographic_value_multiplier,
        audience_quality_tier: enhancedData.audience_quality_tier,
        audience_composition: enhancedData.audience_composition,
        blended_demographics: enhancedData.blended_demographics,
        demographics: enhancedData.demographics,
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

    // Apply Share of Voice before finalizing
    for (const programId of Object.keys(zoneCoverageByProgram)) {
      const entry = zoneCoverageByProgram[programId];

      // Apply share percentage if available
      let sharePercent = 1.0;
      if (clientId) {
        // Get time-weighted share for this program's date range using RPC
        sharePercent = await getShareForDateRange(
          programId,
          clientId,
          startDate,
          endDate
        );

        if (sharePercent > 0 && sharePercent <= 1) {
          console.log(
            `📊 [Zone Coverage] Program ${programId}: Applying time-weighted ${(
              sharePercent * 100
            ).toFixed(
              1
            )}% share for client ${clientId} (from ${startDate} to ${endDate})`
          );
        } else if (sharePercent === 0) {
          // Share is 0 - client has no files in the program
          console.warn(
            `⚠️  [Zone Coverage] Program ${programId}: Share is 0% for client ${clientId}. ` +
              `Client has no active files in program - all zone metrics will be 0`
          );
          // Keep sharePercent at 0 - this will zero out all zone metrics
        } else {
          // Invalid share (negative or > 1)
          console.error(
            `❌ [Zone Coverage] Program ${programId}: Invalid share value ${sharePercent}. Using 100% as fallback.`
          );
          sharePercent = 1.0;
        }
      }

      // Apply share to all time-based metrics (always applies, even if sharePercent = 1.0)
      entry.total_minutes_in_zones *= sharePercent;
      entry.total_hours_in_zones *= sharePercent;
      entry.high_value_exposure_score *= sharePercent;

      // Apply to each zone
      entry.zones.forEach((zone) => {
        zone.minutes_spent *= sharePercent;
        zone.hours_spent *= sharePercent;
        zone.weighted_exposure *= sharePercent;

        // Apply to time breakdown
        Object.keys(zone.time_breakdown).forEach((period) => {
          zone.time_breakdown[period].minutes *= sharePercent;
          zone.time_breakdown[period].hours *= sharePercent;
        });
      });

      // Apply to time zone distribution
      Object.keys(entry.time_zone_distribution).forEach((period) => {
        entry.time_zone_distribution[period].minutes *= sharePercent;
        entry.time_zone_distribution[period].hours *= sharePercent;
      });

      // Apply to zone type distribution
      Object.keys(entry.zone_type_distribution).forEach((zoneType) => {
        entry.zone_type_distribution[zoneType].minutes *= sharePercent;
        entry.zone_type_distribution[zoneType].hours *= sharePercent;
      });

      // Add share info to response
      entry.share_of_voice_percent = Number((sharePercent * 100).toFixed(1));

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

        // Calculate time_breakdown percentages for this zone
        const zoneTotalMinutes =
          z.time_breakdown.morning.minutes +
          z.time_breakdown.afternoon.minutes +
          z.time_breakdown.evening.minutes +
          z.time_breakdown.night.minutes;

        // Calculate percentage for each time period in this zone
        for (const period of [
          "morning",
          "afternoon",
          "evening",
          "night",
          "rush_hour",
        ]) {
          const periodMinutes = z.time_breakdown[period].minutes;
          z.time_breakdown[period].percentage =
            zoneTotalMinutes > 0
              ? Math.round((periodMinutes / zoneTotalMinutes) * 1000) / 10
              : 0;
        }
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

      // Calculate zone type distribution percentages
      const totalZoneTypeMinutes =
        entry.zone_type_distribution.tourist.minutes +
        entry.zone_type_distribution.shopping.minutes +
        entry.zone_type_distribution.residential.minutes +
        entry.zone_type_distribution.mixed.minutes;

      for (const zoneType of ["tourist", "shopping", "residential", "mixed"]) {
        const minutes = entry.zone_type_distribution[zoneType].minutes;
        entry.zone_type_distribution[zoneType].percentage =
          totalZoneTypeMinutes > 0
            ? Math.round((minutes / totalZoneTypeMinutes) * 1000) / 10
            : 0;
      }

      // Round totals
      entry.total_minutes_in_zones =
        Math.round(entry.total_minutes_in_zones * 100) / 100;
      entry.high_value_exposure_score =
        Math.round(entry.high_value_exposure_score * 100) / 100;

      // NEW: Calculate aggregate demographics summary for this program
      entry.demographics_summary = calculateAggregateDemographics(entry.zones);
    }

    return zoneCoverageByProgram;
  } catch (error) {
    console.error("Error building zone coverage metrics:", error.message);
    throw error;
  }
}

/**
 * Merge zone coverage entries across sibling programs that belong to the
 * same split-mode campaign. In split mode a campaign has multiple
 * campaign_playlists rows, each with its own program_id, but we want one
 * zone-coverage card per campaign — keyed by the primary program_id — so
 * the response matches how campaign_metrics is rolled up in the same
 * endpoints.
 *
 * Input `zoneCoverageByProgram` is the output of `buildZoneCoverageMetrics`
 * keyed by program_id. `siblingGroups` is an array describing how to merge:
 *   [{ primaryProgramId: <number>, programIds: [<number>, ...] }, ...]
 *
 * Programs not covered by any group are passed through unchanged. Groups of
 * size 1 are also passed through (re-keyed under the primary if needed).
 *
 * @param {Object} zoneCoverageByProgram
 * @param {Array<{primaryProgramId:number, programIds:Array<number>}>} siblingGroups
 * @returns {Object} merged map keyed by primary program_id
 */
function mergeZoneCoverageForSplitCampaigns(
  zoneCoverageByProgram,
  siblingGroups
) {
  if (!zoneCoverageByProgram || Object.keys(zoneCoverageByProgram).length === 0) {
    return zoneCoverageByProgram || {};
  }
  if (!siblingGroups || siblingGroups.length === 0) {
    return zoneCoverageByProgram;
  }

  const lookup = (pid) =>
    zoneCoverageByProgram[pid] ||
    zoneCoverageByProgram[String(pid)] ||
    zoneCoverageByProgram[Number(pid)] ||
    null;

  const merged = {};
  const consumed = new Set();

  for (const group of siblingGroups) {
    const { primaryProgramId, programIds } = group || {};
    if (!primaryProgramId || !programIds || programIds.length === 0) continue;

    const siblings = [];
    for (const pid of programIds) {
      consumed.add(String(pid));
      const entry = lookup(pid);
      if (entry) siblings.push(entry);
    }

    if (siblings.length === 0) continue;

    // Single-sibling groups pass through; ensure we key under the primary
    if (siblings.length === 1) {
      merged[primaryProgramId] = {
        ...siblings[0],
        program_id: primaryProgramId,
        program_ids: programIds,
      };
      continue;
    }

    // --- Multi-sibling merge ---

    // Merge per-zone entries (same zone_id across siblings → sum time fields)
    const zonesByZoneId = new Map();
    for (const sib of siblings) {
      for (const zone of sib.zones || []) {
        const existing = zonesByZoneId.get(zone.zone_id);
        if (!existing) {
          zonesByZoneId.set(zone.zone_id, {
            ...zone,
            time_breakdown: {
              morning: { ...zone.time_breakdown.morning },
              afternoon: { ...zone.time_breakdown.afternoon },
              evening: { ...zone.time_breakdown.evening },
              night: { ...zone.time_breakdown.night },
              rush_hour: { ...zone.time_breakdown.rush_hour },
            },
          });
        } else {
          existing.minutes_spent += Number(zone.minutes_spent) || 0;
          existing.hours_spent += Number(zone.hours_spent) || 0;
          existing.weighted_exposure += Number(zone.weighted_exposure) || 0;
          existing.demographics_enhanced_exposure =
            (Number(existing.demographics_enhanced_exposure) || 0) +
            (Number(zone.demographics_enhanced_exposure) || 0);
          for (const period of [
            "morning",
            "afternoon",
            "evening",
            "night",
            "rush_hour",
          ]) {
            existing.time_breakdown[period].minutes +=
              Number(zone.time_breakdown?.[period]?.minutes) || 0;
            existing.time_breakdown[period].hours +=
              Number(zone.time_breakdown?.[period]?.hours) || 0;
          }
        }
      }
    }

    const mergedZones = Array.from(zonesByZoneId.values());

    // Sum scalar totals across siblings
    const totalMinutes = siblings.reduce(
      (s, sib) => s + (Number(sib.total_minutes_in_zones) || 0),
      0
    );
    const totalExposure = siblings.reduce(
      (s, sib) => s + (Number(sib.high_value_exposure_score) || 0),
      0
    );

    // Rebuild time_zone_distribution by summing across siblings
    const tzd = {
      morning: { minutes: 0 },
      afternoon: { minutes: 0 },
      evening: { minutes: 0 },
      night: { minutes: 0 },
      rush_hour: { minutes: 0 },
    };
    for (const sib of siblings) {
      for (const period of Object.keys(tzd)) {
        tzd[period].minutes +=
          Number(sib.time_zone_distribution?.[period]?.minutes) || 0;
      }
    }

    const totalTimeForPct =
      tzd.morning.minutes +
      tzd.afternoon.minutes +
      tzd.evening.minutes +
      tzd.night.minutes;

    for (const period of [
      "morning",
      "afternoon",
      "evening",
      "night",
      "rush_hour",
    ]) {
      tzd[period].hours = Math.round((tzd[period].minutes / 60) * 100) / 100;
      tzd[period].percentage =
        totalTimeForPct > 0
          ? Math.round((tzd[period].minutes / totalTimeForPct) * 1000) / 10
          : 0;
      tzd[period].minutes = Math.round(tzd[period].minutes * 100) / 100;
    }

    // Rebuild zone_type_distribution from merged zones (distinct zones per type)
    const ztd = {
      tourist: { zones_count: 0, minutes: 0 },
      shopping: { zones_count: 0, minutes: 0 },
      residential: { zones_count: 0, minutes: 0 },
      mixed: { zones_count: 0, minutes: 0 },
    };
    for (const z of mergedZones) {
      if (ztd[z.zone_type]) {
        ztd[z.zone_type].zones_count += 1;
        ztd[z.zone_type].minutes += Number(z.minutes_spent) || 0;
      }
    }
    const ztdTotal =
      ztd.tourist.minutes +
      ztd.shopping.minutes +
      ztd.residential.minutes +
      ztd.mixed.minutes;
    for (const type of ["tourist", "shopping", "residential", "mixed"]) {
      ztd[type].hours = Math.round((ztd[type].minutes / 60) * 100) / 100;
      ztd[type].percentage =
        ztdTotal > 0
          ? Math.round((ztd[type].minutes / ztdTotal) * 1000) / 10
          : 0;
      ztd[type].minutes = Math.round(ztd[type].minutes * 100) / 100;
    }

    // Finalize per-zone rounding and recompute percentages against merged totals
    mergedZones.forEach((z) => {
      z.minutes_spent = Math.round(z.minutes_spent * 100) / 100;
      z.hours_spent = Math.round((z.minutes_spent / 60) * 100) / 100;
      z.weighted_exposure = Math.round(z.weighted_exposure * 100) / 100;
      z.demographics_enhanced_exposure =
        Math.round((z.demographics_enhanced_exposure || 0) * 100) / 100;
      z.percentage_of_total_time =
        totalTimeForPct > 0
          ? Math.round((z.minutes_spent / totalTimeForPct) * 1000) / 10
          : 0;

      const zoneTotal =
        z.time_breakdown.morning.minutes +
        z.time_breakdown.afternoon.minutes +
        z.time_breakdown.evening.minutes +
        z.time_breakdown.night.minutes;

      for (const period of [
        "morning",
        "afternoon",
        "evening",
        "night",
        "rush_hour",
      ]) {
        z.time_breakdown[period].minutes =
          Math.round(z.time_breakdown[period].minutes * 100) / 100;
        z.time_breakdown[period].hours =
          Math.round((z.time_breakdown[period].minutes / 60) * 100) / 100;
        z.time_breakdown[period].percentage =
          zoneTotal > 0
            ? Math.round(
                (z.time_breakdown[period].minutes / zoneTotal) * 1000
              ) / 10
            : 0;
      }
    });

    mergedZones.sort((a, b) => b.weighted_exposure - a.weighted_exposure);

    // Average share of voice across siblings that had a value
    const sovValues = siblings
      .map((s) => s.share_of_voice_percent)
      .filter((v) => v != null);
    const sovAvg =
      sovValues.length > 0
        ? parseFloat(
            (sovValues.reduce((s, v) => s + v, 0) / sovValues.length).toFixed(1)
          )
        : null;

    // Date range = earliest start, latest end across siblings
    const starts = siblings
      .map((s) => s.date_range?.start)
      .filter(Boolean)
      .map((d) => new Date(d));
    const ends = siblings
      .map((s) => s.date_range?.end)
      .filter(Boolean)
      .map((d) => new Date(d));
    const dateRange = {
      start:
        starts.length > 0
          ? new Date(Math.min(...starts)).toISOString()
          : siblings[0].date_range?.start || null,
      end:
        ends.length > 0
          ? new Date(Math.max(...ends)).toISOString()
          : siblings[0].date_range?.end || null,
    };

    const totalZonesAvailable = Math.max(
      ...siblings.map((s) => Number(s.total_zones_available) || 0)
    );
    const totalZonesVisited = mergedZones.length;
    const coveragePercentage =
      totalZonesAvailable > 0
        ? Math.round((totalZonesVisited / totalZonesAvailable) * 1000) / 10
        : 0;

    // Strip trailing split-playlist label like "Company - 2026-07-21 3D" → "Company - 2026-07-21"
    const baseName = siblings[0].program_name || "";
    const cleanName =
      baseName.replace(/(-\s*\d{4}-\d{2}-\d{2})\s+\S.*$/, "$1").trim() ||
      baseName;

    merged[primaryProgramId] = {
      ...siblings[0],
      program_id: primaryProgramId,
      program_name: cleanName || null,
      program_ids: programIds,
      total_zones_visited: totalZonesVisited,
      total_zones_available: totalZonesAvailable,
      coverage_percentage: coveragePercentage,
      total_minutes_in_zones: Math.round(totalMinutes * 100) / 100,
      total_hours_in_zones: Math.round((totalMinutes / 60) * 100) / 100,
      high_value_exposure_score: Math.round(totalExposure * 100) / 100,
      zones: mergedZones,
      zone_type_distribution: ztd,
      time_zone_distribution: tzd,
      date_range: dateRange,
      share_of_voice_percent: sovAvg,
      demographics_summary: calculateAggregateDemographics(mergedZones),
      isActive: siblings.some((s) => s.isActive),
    };
  }

  // Pass through any programs not covered by a sibling group
  for (const [pid, coverage] of Object.entries(zoneCoverageByProgram)) {
    if (consumed.has(String(pid))) continue;
    if (!(pid in merged)) {
      merged[pid] = coverage;
    }
  }

  return merged;
}

module.exports = {
  buildZoneCoverageMetrics,
  mergeZoneCoverageForSplitCampaigns,
};
