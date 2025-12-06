const { supabase } = require("../config/supabase");

/**
 * Get comprehensive analytics for a driver including zone time breakdown
 * @param {number} driverId - Driver ID
 * @param {string} startDate - ISO date string (e.g., '2025-11-01')
 * @param {string} endDate - ISO date string (e.g., '2025-11-15')
 * @returns {Promise<object>} - Analytics data including zone breakdown
 */
async function getDriverAnalytics(driverId, startDate, endDate) {
  try {
    // Get driver info
    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("*")
      .eq("id", driverId)
      .single();

    if (driverError) {
      throw new Error(`Failed to fetch driver: ${driverError.message}`);
    }

    // Get zone time breakdown
    const zoneBreakdown = await getDriverZoneTimeBreakdown(
      driverId,
      startDate,
      endDate
    );

    // Get total online time
    const totalOnlineTime = await getDriverTotalOnlineTime(
      driverId,
      startDate,
      endDate
    );

    // Get assignment history for the period
    const assignments = await getDriverAssignmentsDuringPeriod(
      driverId,
      startDate,
      endDate
    );

    return {
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        email: driver.email,
      },
      period: {
        start_date: startDate,
        end_date: endDate,
      },
      summary: {
        total_online_hours: totalOnlineTime.total_online_hours,
        total_online_seconds: totalOnlineTime.total_online_seconds,
        total_zones_visited: zoneBreakdown.length,
        terminals_used: assignments.length,
      },
      zone_breakdown: zoneBreakdown,
      assignments: assignments,
    };
  } catch (error) {
    console.error(
      `Error getting driver analytics for driver ${driverId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get time breakdown by zone for a driver
 * @param {number} driverId - Driver ID
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<Array>} - Array of zone time data
 */
async function getDriverZoneTimeBreakdown(driverId, startDate, endDate) {
  try {
    // Query to get online time per zone for this driver
    // This joins assignments with status logs and zones
    const { data, error } = await supabase.rpc(
      "get_driver_zone_time_breakdown",
      {
        p_driver_id: driverId,
        p_start_date: startDate,
        p_end_date: endDate,
      }
    );

    if (error) {
      // If RPC doesn't exist yet, fall back to manual query
      console.warn(
        `⚠️ RPC function error, using fallback query:`,
        error.message,
        error
      );
      return await getDriverZoneTimeBreakdownFallback(
        driverId,
        startDate,
        endDate
      );
    }

    console.log(
      `✅ Using database RPC function (returned ${data?.length || 0} zones)`
    );

    return data || [];
  } catch (error) {
    console.error(
      `Error getting zone time breakdown for driver ${driverId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Fallback method for zone time breakdown (direct query)
 * Uses delta-based calculation between GPS points for accurate zone time
 * @param {number} driverId - Driver ID
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<Array>} - Array of zone time data
 */
async function getDriverZoneTimeBreakdownFallback(
  driverId,
  startDate,
  endDate
) {
  try {
    // Step 1: Get all assignments for this driver in the date range
    const { data: assignments, error: assignmentError } = await supabase
      .from("terminal_driver_assignments")
      .select("terminal_id, assigned_at, unassigned_at")
      .eq("driver_id", driverId)
      .or(
        `and(assigned_at.lte.${endDate},unassigned_at.gte.${startDate}),and(assigned_at.lte.${endDate},unassigned_at.is.null)`
      );

    if (assignmentError) {
      throw new Error(
        `Failed to fetch assignments: ${assignmentError.message}`
      );
    }

    if (!assignments || assignments.length === 0) {
      return [];
    }

    // Step 2: Get all online status logs for these terminals during assignment periods
    const terminalIds = [...new Set(assignments.map((a) => a.terminal_id))];

    const { data: statusLogs, error: statusError } = await supabase
      .from("terminal_status_log")
      .select("id, terminal_id, status, status_changed_at, duration_seconds")
      .in("terminal_id", terminalIds)
      .eq("status", "online")
      .gte("status_changed_at", startDate)
      .lte("status_changed_at", `${endDate}T23:59:59`)
      .not("duration_seconds", "is", null);

    if (statusError) {
      throw new Error(`Failed to fetch status logs: ${statusError.message}`);
    }

    if (!statusLogs || statusLogs.length === 0) {
      return [];
    }

    // Step 3: Filter status logs to only include times when driver was assigned
    const filteredLogs = statusLogs.filter((log) => {
      const logTime = new Date(log.status_changed_at);
      return assignments.some((assignment) => {
        if (assignment.terminal_id !== log.terminal_id) return false;
        const assignedAt = new Date(assignment.assigned_at);
        const unassignedAt = assignment.unassigned_at
          ? new Date(assignment.unassigned_at)
          : new Date();
        return logTime >= assignedAt && logTime <= unassignedAt;
      });
    });

    if (filteredLogs.length === 0) {
      return [];
    }

    // Step 4: For each online session, get GPS data and calculate zone time using deltas
    const zoneMap = new Map();
    let totalSessionSeconds = 0;

    for (const log of filteredLogs) {
      const sessionStart = new Date(log.status_changed_at);
      const sessionEnd = new Date(
        sessionStart.getTime() + log.duration_seconds * 1000
      );
      totalSessionSeconds += log.duration_seconds;

      // Get GPS data during this online session
      const { data: gpsData, error: gpsError } = await supabase
        .from("terminal_gps_data")
        .select("zone_id, recorded_at")
        .eq("terminal_id", log.terminal_id)
        .gte("recorded_at", sessionStart.toISOString())
        .lte("recorded_at", sessionEnd.toISOString())
        .not("zone_id", "is", null)
        .order("recorded_at", { ascending: true });

      if (gpsError || !gpsData || gpsData.length === 0) {
        continue; // Skip this session if no GPS data
      }

      // Calculate time in each zone using delta between consecutive GPS points
      // This is more accurate than averaging, especially with variable GPS intervals
      for (let i = 0; i < gpsData.length; i++) {
        const currentPoint = gpsData[i];
        const currentTime = new Date(currentPoint.recorded_at);

        // Determine the end time for this GPS point's zone
        let deltaEndTime;
        if (i < gpsData.length - 1) {
          // Use the next GPS point's timestamp
          deltaEndTime = new Date(gpsData[i + 1].recorded_at);
        } else {
          // Last GPS point - use session end time
          deltaEndTime = sessionEnd;
        }

        // Calculate delta in seconds
        let deltaSeconds = (deltaEndTime - currentTime) / 1000;

        // Cap delta to prevent unreasonable values (max 10 minutes between points)
        // This handles cases where GPS had gaps
        const MAX_DELTA_SECONDS = 600; // 10 minutes
        if (deltaSeconds > MAX_DELTA_SECONDS) {
          deltaSeconds = MAX_DELTA_SECONDS;
        }

        // Ensure non-negative
        if (deltaSeconds < 0) {
          deltaSeconds = 0;
        }

        // Initialize zone in map if needed
        if (!zoneMap.has(currentPoint.zone_id)) {
          zoneMap.set(currentPoint.zone_id, {
            zone_id: currentPoint.zone_id,
            online_seconds: 0,
            gps_points: 0,
          });
        }

        const zoneData = zoneMap.get(currentPoint.zone_id);
        zoneData.online_seconds += deltaSeconds;
        zoneData.gps_points += 1;
      }
    }

    if (zoneMap.size === 0) {
      return [];
    }

    // Step 5: Normalize zone times to not exceed total session time
    const totalZoneSeconds = Array.from(zoneMap.values()).reduce(
      (sum, z) => sum + z.online_seconds,
      0
    );

    if (totalZoneSeconds > totalSessionSeconds && totalZoneSeconds > 0) {
      const ratio = totalSessionSeconds / totalZoneSeconds;
      console.log(
        `⚠️ Zone time (${totalZoneSeconds}s) exceeded session time (${totalSessionSeconds}s), normalizing by ratio ${ratio.toFixed(
          3
        )}`
      );
      zoneMap.forEach((zoneData) => {
        zoneData.online_seconds = zoneData.online_seconds * ratio;
      });
    }

    // Step 6: Get zone info
    const zoneIds = Array.from(zoneMap.keys());
    const { data: zones, error: zoneError } = await supabase
      .from("nyc_zones")
      .select("id, name, display_name, zone_type, borough")
      .in("id", zoneIds);

    if (zoneError) {
      throw new Error(`Failed to fetch zones: ${zoneError.message}`);
    }

    // Step 7: Build final results
    const results = Array.from(zoneMap.entries()).map(([zoneId, zoneData]) => {
      const zone = zones.find((z) => z.id === zoneId);
      return {
        zone_id: zoneId,
        zone_name: zone?.name || "Unknown",
        zone_display_name: zone?.display_name || "Unknown",
        zone_type: zone?.zone_type || null,
        borough: zone?.borough || null,
        online_seconds: Math.round(zoneData.online_seconds),
        online_hours: Math.round((zoneData.online_seconds / 3600) * 100) / 100,
        gps_points: zoneData.gps_points,
      };
    });

    // Sort by online time descending
    results.sort((a, b) => b.online_seconds - a.online_seconds);

    return results;
  } catch (error) {
    console.error(
      `Error in fallback zone time breakdown for driver ${driverId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get total online time for a driver across all zones
 * @param {number} driverId - Driver ID
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<object>} - Total online time data
 */
async function getDriverTotalOnlineTime(driverId, startDate, endDate) {
  try {
    // Get all assignments for this driver in the date range
    const { data: assignments, error: assignmentError } = await supabase
      .from("terminal_driver_assignments")
      .select("terminal_id, assigned_at, unassigned_at")
      .eq("driver_id", driverId)
      .or(
        `and(assigned_at.lte.${endDate},unassigned_at.gte.${startDate}),and(assigned_at.lte.${endDate},unassigned_at.is.null)`
      );

    if (assignmentError) {
      throw new Error(
        `Failed to fetch assignments: ${assignmentError.message}`
      );
    }

    if (!assignments || assignments.length === 0) {
      return {
        total_online_seconds: 0,
        total_online_hours: 0,
        total_offline_seconds: 0,
        total_offline_hours: 0,
      };
    }

    const terminalIds = [...new Set(assignments.map((a) => a.terminal_id))];

    // Get all status logs for these terminals during assignment periods
    const { data: statusLogs, error: statusError } = await supabase
      .from("terminal_status_log")
      .select("terminal_id, status, status_changed_at, duration_seconds")
      .in("terminal_id", terminalIds)
      .gte("status_changed_at", startDate)
      .lte("status_changed_at", `${endDate}T23:59:59`)
      .not("duration_seconds", "is", null);

    if (statusError) {
      throw new Error(`Failed to fetch status logs: ${statusError.message}`);
    }

    // Filter logs to only include times when driver was assigned
    const filteredLogs = (statusLogs || []).filter((log) => {
      const logTime = new Date(log.status_changed_at);
      return assignments.some((assignment) => {
        if (assignment.terminal_id !== log.terminal_id) return false;
        const assignedAt = new Date(assignment.assigned_at);
        const unassignedAt = assignment.unassigned_at
          ? new Date(assignment.unassigned_at)
          : new Date();
        return logTime >= assignedAt && logTime <= unassignedAt;
      });
    });

    // Calculate totals
    let totalOnlineSeconds = 0;
    let totalOfflineSeconds = 0;

    filteredLogs.forEach((log) => {
      if (log.status === "online") {
        totalOnlineSeconds += log.duration_seconds;
      } else {
        totalOfflineSeconds += log.duration_seconds;
      }
    });

    return {
      total_online_seconds: totalOnlineSeconds,
      total_online_hours: Math.round((totalOnlineSeconds / 3600) * 100) / 100,
      total_offline_seconds: totalOfflineSeconds,
      total_offline_hours: Math.round((totalOfflineSeconds / 3600) * 100) / 100,
    };
  } catch (error) {
    console.error(
      `Error getting total online time for driver ${driverId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get assignments for a driver during a specific period
 * @param {number} driverId - Driver ID
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<Array>} - Array of assignment records
 */
async function getDriverAssignmentsDuringPeriod(driverId, startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from("terminal_driver_assignments")
      .select("*, terminals(terminalid, name, group_name)")
      .eq("driver_id", driverId)
      .or(
        `and(assigned_at.lte.${endDate},unassigned_at.gte.${startDate}),and(assigned_at.lte.${endDate},unassigned_at.is.null)`
      )
      .order("assigned_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch assignments: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error(
      `Error getting assignments for driver ${driverId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get comparative analytics for all drivers
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<Array>} - Array of driver analytics
 */
async function getAllDriversAnalytics(startDate, endDate) {
  try {
    // Get all drivers who had assignments during this period
    const { data: assignments, error: assignmentError } = await supabase
      .from("terminal_driver_assignments")
      .select("driver_id, drivers(id, name, phone, email)")
      .or(
        `and(assigned_at.lte.${endDate},unassigned_at.gte.${startDate}),and(assigned_at.lte.${endDate},unassigned_at.is.null)`
      );

    if (assignmentError) {
      throw new Error(
        `Failed to fetch assignments: ${assignmentError.message}`
      );
    }

    if (!assignments || assignments.length === 0) {
      return [];
    }

    // Get unique drivers
    const driverMap = new Map();
    assignments.forEach((assignment) => {
      if (assignment.drivers && !driverMap.has(assignment.driver_id)) {
        driverMap.set(assignment.driver_id, assignment.drivers);
      }
    });

    // Get analytics for each driver
    const analyticsPromises = Array.from(driverMap.keys()).map((driverId) =>
      getDriverAnalytics(driverId, startDate, endDate)
    );

    const allAnalytics = await Promise.all(analyticsPromises);

    // Sort by total online time descending
    allAnalytics.sort(
      (a, b) => b.summary.total_online_hours - a.summary.total_online_hours
    );

    return allAnalytics;
  } catch (error) {
    console.error(`Error getting all drivers analytics:`, error.message);
    throw error;
  }
}

module.exports = {
  getDriverAnalytics,
  getDriverZoneTimeBreakdown,
  getDriverTotalOnlineTime,
  getDriverAssignmentsDuringPeriod,
  getAllDriversAnalytics,
};
