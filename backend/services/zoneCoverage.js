const { supabase } = require("../config/supabase");

/**
 * Build zone coverage metrics for a client's campaign
 * Shows which NYC neighborhoods were reached, time spent in each zone,
 * and high-value zone exposure
 * 
 * @param {Array<number>} programIds - Client's active program IDs
 * @param {Array<string>} terminalIds - Terminal IDs playing these programs
 * @param {string} startDate - Campaign start date (YYYY-MM-DD)
 * @param {string} endDate - Campaign end date (YYYY-MM-DD or ISO timestamp)
 * @returns {Object} Zone coverage metrics
 */
async function buildZoneCoverageMetrics(programIds, terminalIds, startDate, endDate) {
  // Return empty structure if no programs or terminals
  if (!programIds || programIds.length === 0 || !terminalIds || terminalIds.length === 0) {
    return {
      total_zones_visited: 0,
      total_zones_available: 0,
      coverage_percentage: 0,
      total_minutes_in_zones: 0,
      high_value_exposure_score: 0,
      zones: [],
      zone_type_distribution: {
        tourist: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
        shopping: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
        residential: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
        mixed: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
      },
    };
  }

  // Convert endDate to date format if it's a full ISO timestamp
  const endDateOnly = endDate.split("T")[0];

  try {
    // 1. Get all GPS points with zone information for the campaign period
    const { data: gpsPoints, error: gpsError } = await supabase
      .from("terminal_gps_data")
      .select("id, terminal_id, zone_id, recorded_at, data_date")
      .in("terminal_id", terminalIds)
      .gte("data_date", startDate)
      .lte("data_date", endDateOnly)
      .not("zone_id", "is", null)
      .order("terminal_id", { ascending: true })
      .order("recorded_at", { ascending: true });

    if (gpsError) {
      console.error("Error fetching GPS points for zone coverage:", gpsError.message);
      throw new Error(`Failed to fetch GPS points: ${gpsError.message}`);
    }

    // If no GPS points with zones, return early
    if (!gpsPoints || gpsPoints.length === 0) {
      const { data: allZones } = await supabase.from("nyc_zones").select("id");
      return {
        total_zones_visited: 0,
        total_zones_available: allZones?.length || 0,
        coverage_percentage: 0,
        total_minutes_in_zones: 0,
        high_value_exposure_score: 0,
        zones: [],
        zone_type_distribution: {
          tourist: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
          shopping: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
          residential: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
          mixed: { zones_count: 0, minutes: 0, hours: 0, percentage: 0 },
        },
      };
    }

    // 2. Get playing sessions to filter only active ad time
    const { data: playingSessions, error: playingError } = await supabase
      .from("playing")
      .select("terminal_id, program_id, started_at, ended_at, status")
      .in("terminal_id", terminalIds)
      .in("program_id", programIds)
      .gte("started_at", `${startDate}T00:00:00`)
      .order("terminal_id", { ascending: true })
      .order("started_at", { ascending: true });

    if (playingError) {
      console.error("Error fetching playing sessions:", playingError.message);
      throw new Error(`Failed to fetch playing sessions: ${playingError.message}`);
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

    // 4. Calculate time in each zone
    // For each GPS point, check if it was during an active playing session
    // Track consecutive points in same zone to calculate duration

    const zoneMinutes = new Map(); // zone_id -> total minutes

    // Helper function to check if a GPS point was during active playing
    const isPointDuringPlaying = (terminalId, timestamp) => {
      if (!playingSessions || playingSessions.length === 0) return false;

      const pointTime = new Date(timestamp);
      return playingSessions.some((session) => {
        if (session.terminal_id !== terminalId) return false;
        const startTime = new Date(session.started_at);
        const endTime = session.ended_at ? new Date(session.ended_at) : new Date();
        return pointTime >= startTime && pointTime <= endTime;
      });
    };

    // Track last point per terminal for time calculation
    const lastPointByTerminal = new Map(); // terminal_id -> {zone_id, timestamp}

    for (const point of gpsPoints) {
      const isActive = isPointDuringPlaying(point.terminal_id, point.recorded_at);

      if (isActive) {
        const lastPoint = lastPointByTerminal.get(point.terminal_id);

        if (lastPoint && lastPoint.zone_id === point.zone_id) {
          // Same zone - calculate duration since last point
          const timeDiff = new Date(point.recorded_at) - new Date(lastPoint.timestamp);
          const minutesDiff = timeDiff / (1000 * 60);

          // Only count if time difference is reasonable (< 30 minutes)
          // This filters out gaps when terminal was offline
          if (minutesDiff > 0 && minutesDiff <= 30) {
            const currentMinutes = zoneMinutes.get(point.zone_id) || 0;
            zoneMinutes.set(point.zone_id, currentMinutes + minutesDiff);
          }
        } else if (lastPoint && lastPoint.zone_id !== point.zone_id) {
          // Zone changed - add a small duration (1 minute) for presence in new zone
          const currentMinutes = zoneMinutes.get(point.zone_id) || 0;
          zoneMinutes.set(point.zone_id, currentMinutes + 1);
        } else {
          // First point for this terminal - count 1 minute of presence
          const currentMinutes = zoneMinutes.get(point.zone_id) || 0;
          zoneMinutes.set(point.zone_id, currentMinutes + 1);
        }

        // Update last point tracker
        lastPointByTerminal.set(point.terminal_id, {
          zone_id: point.zone_id,
          timestamp: point.recorded_at,
        });
      }
    }

    // 5. Build zone metrics
    const zones = [];
    let totalMinutes = 0;
    let totalWeightedExposure = 0;

    const zoneTypeStats = {
      tourist: { zones: new Set(), minutes: 0 },
      shopping: { zones: new Set(), minutes: 0 },
      residential: { zones: new Set(), minutes: 0 },
      mixed: { zones: new Set(), minutes: 0 },
    };

    for (const [zoneId, minutes] of zoneMinutes.entries()) {
      const zoneInfo = zoneMap.get(zoneId);
      if (!zoneInfo) continue;

      const hours = minutes / 60;
      const weightedExposure = minutes * zoneInfo.density_multiplier;

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
      });

      totalMinutes += minutes;
      totalWeightedExposure += weightedExposure;

      // Track zone type stats
      if (zoneTypeStats[zoneInfo.zone_type]) {
        zoneTypeStats[zoneInfo.zone_type].zones.add(zoneId);
        zoneTypeStats[zoneInfo.zone_type].minutes += minutes;
      }
    }

    // Calculate percentages now that we have total
    zones.forEach((zone) => {
      zone.percentage_of_total_time =
        totalMinutes > 0 ? Math.round((zone.minutes_spent / totalMinutes) * 1000) / 10 : 0;
    });

    // Sort zones by minutes spent (descending)
    zones.sort((a, b) => b.minutes_spent - a.minutes_spent);

    // Build zone type distribution
    const zoneTypeDistribution = {};
    for (const [type, stats] of Object.entries(zoneTypeStats)) {
      const hours = stats.minutes / 60;
      const percentage =
        totalMinutes > 0 ? Math.round((stats.minutes / totalMinutes) * 1000) / 10 : 0;

      zoneTypeDistribution[type] = {
        zones_count: stats.zones.size,
        minutes: Math.round(stats.minutes * 100) / 100,
        hours: Math.round(hours * 100) / 100,
        percentage: percentage,
      };
    }

    // Calculate coverage percentage
    const coveragePercentage =
      allZones.length > 0 ? Math.round((zones.length / allZones.length) * 1000) / 10 : 0;

    return {
      total_zones_visited: zones.length,
      total_zones_available: allZones.length,
      coverage_percentage: coveragePercentage,
      total_minutes_in_zones: Math.round(totalMinutes * 100) / 100,
      total_hours_in_zones: Math.round((totalMinutes / 60) * 100) / 100,
      high_value_exposure_score: Math.round(totalWeightedExposure * 100) / 100,
      zones: zones,
      zone_type_distribution: zoneTypeDistribution,
    };
  } catch (error) {
    console.error("Error building zone coverage metrics:", error.message);
    throw error;
  }
}

module.exports = {
  buildZoneCoverageMetrics,
};

