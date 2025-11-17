const { supabase } = require("../config/supabase");
const { markCurrentPlayingAsCompleted } = require("./playing");

/**
 * Get the most recent zone_id for a terminal from GPS data
 * @param {string} terminalId - The terminal ID
 * @param {number} lookbackMinutes - How many minutes to look back (default: 30)
 * @returns {Promise<number|null>} - The zone_id or null if not found
 */
async function getMostRecentZone(terminalId, lookbackMinutes = 30) {
  try {
    const lookbackTime = new Date();
    lookbackTime.setMinutes(lookbackTime.getMinutes() - lookbackMinutes);

    const { data, error } = await supabase
      .from("terminal_gps_data")
      .select("zone_id")
      .eq("terminal_id", terminalId)
      .not("zone_id", "is", null)
      .gte("recorded_at", lookbackTime.toISOString())
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      console.warn(
        `⚠️ Failed to fetch recent zone for ${terminalId}:`,
        error.message
      );
      return null;
    }

    return data?.zone_id || null;
  } catch (error) {
    console.warn(`⚠️ Error fetching zone for ${terminalId}:`, error.message);
    return null;
  }
}

function determineOnlineStatus(terminalData) {
  const currentTime = Math.floor(Date.now() / 1000);
  const OFFLINE_THRESHOLD = 90;

  const lastReportTime = terminalData.post_meta?._led_latest_report_time;

  if (!lastReportTime) {
    return {
      isOnline: false,
      reason: "no_report_time",
      indicators: {
        lastReportTime: null,
        timeSinceLastReport: null,
        threshold: OFFLINE_THRESHOLD,
      },
    };
  }

  const timeSinceLastReport = currentTime - lastReportTime;
  const isOnline = timeSinceLastReport <= OFFLINE_THRESHOLD;

  return {
    isOnline,
    reason: isOnline ? "online" : "offline",
    indicators: {
      lastReportTime,
      timeSinceLastReport,
      threshold: OFFLINE_THRESHOLD,
      lastReportDate: new Date(lastReportTime * 1000).toISOString(),
    },
  };
}

async function getCurrentTerminalStatus(terminalId) {
  try {
    const { data, error } = await supabase
      .from("terminal_status_log")
      .select("*")
      .eq("terminal_id", terminalId)
      .order("status_changed_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error(`Failed to get current status: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error(
      `Error getting current status for ${terminalId}:`,
      error.message
    );
    return null;
  }
}

async function logTerminalStatusChange(statusData) {
  try {
    const { data, error } = await supabase
      .from("terminal_status_log")
      .insert(statusData)
      .select()
      .single();

    if (error) throw new Error(`Failed to log status change: ${error.message}`);

    console.log(
      `📊 Status logged: ${statusData.terminal_id} is ${statusData.status} (${statusData.reason})`
    );
    return data;
  } catch (error) {
    console.error(`Error logging status change:`, error.message);
    throw error;
  }
}

async function updateTerminalStatus(terminalId, terminalData) {
  try {
    const { isOnline, reason } = determineOnlineStatus(terminalData);
    const currentStatus = await getCurrentTerminalStatus(terminalId);

    const powerStatus =
      terminalData?.power_status ??
      terminalData?.post_meta?._led_status?.powerstatus?.powerstatus?.toString?.() ??
      null;
    const ledLatestTime =
      terminalData?.post_meta?._led_latest_report_time ?? null;

    if (
      !currentStatus ||
      currentStatus.status !== (isOnline ? "online" : "offline")
    ) {
      const now = new Date().toISOString();

      // If terminal is going offline, clean up current playing records
      if (currentStatus && currentStatus.status === "online" && !isOnline) {
        console.log(
          `🔄 Terminal ${terminalId} going offline - cleaning up current playing records`
        );
        try {
          const cleanupResult = await markCurrentPlayingAsCompleted(terminalId);
          console.log(
            `✅ Cleaned up ${cleanupResult.updated} playing records for offline terminal ${terminalId}`
          );
        } catch (cleanupError) {
          console.warn(
            `⚠️ Failed to cleanup playing records for terminal ${terminalId}:`,
            cleanupError.message
          );
        }
      }

      if (currentStatus) {
        const previousChangeTime = new Date(currentStatus.status_changed_at);
        const durationSeconds = Math.round(
          (new Date(now) - previousChangeTime) / 1000
        );

        console.log(
          `⏱️ Closing previous status row id=${currentStatus.id} (${currentStatus.status}) with duration_seconds=${durationSeconds}`
        );

        const { error: prevUpdateError } = await supabase
          .from("terminal_status_log")
          .update({
            duration_seconds: durationSeconds,
            api_response_at: now,
          })
          .eq("id", currentStatus.id);

        if (prevUpdateError) {
          console.warn(
            `⚠️ Failed to update previous status row ${currentStatus.id}: ${prevUpdateError.message}`
          );
        }
      }

      // Fetch the most recent zone for this terminal
      const zoneId = await getMostRecentZone(terminalId);
      if (zoneId) {
        console.log(`📍 Terminal ${terminalId} zone detected: ${zoneId}`);
      }

      const statusData = {
        terminal_id: terminalId,
        status: isOnline ? "online" : "offline",
        status_changed_at: now,
        duration_seconds: null,
        power_status: powerStatus,
        led_activity_at: ledLatestTime
          ? new Date(ledLatestTime * 1000).toISOString()
          : null,
        api_response_at: now,
        reason: reason,
        zone_id: zoneId,
      };

      console.log(
        `🆕 Inserting new status row for ${terminalId}: ${statusData.status} (duration_seconds should be null)`
      );
      const newStatus = await logTerminalStatusChange(statusData);
      console.log(
        `✅ Inserted status row id=${newStatus.id} status=${newStatus.status} duration_seconds=${newStatus.duration_seconds}`
      );
      return newStatus;
    }

    if (currentStatus) {
      await supabase
        .from("terminal_status_log")
        .update({ api_response_at: new Date().toISOString() })
        .eq("id", currentStatus.id);
    }

    return null;
  } catch (error) {
    console.error(
      `Error updating terminal status for ${terminalId}:`,
      error.message
    );
    return null;
  }
}

async function getTerminalUptimeAnalytics(
  terminalId = null,
  startDate,
  endDate
) {
  try {
    let query = supabase
      .from("terminal_status_log")
      .select(
        "terminal_id, status, status_changed_at, duration_seconds, reason"
      )
      .gte("status_changed_at", `${startDate}T00:00:00`)
      .lt("status_changed_at", `${endDate}T23:59:59`);

    if (terminalId) {
      query = query.eq("terminal_id", terminalId);
    }

    const { data, error } = await query;

    if (error)
      throw new Error(`Failed to fetch uptime analytics: ${error.message}`);

    const analytics = {};

    data.forEach((record) => {
      const tid = record.terminal_id;
      if (!analytics[tid]) {
        analytics[tid] = {
          terminal_id: tid,
          total_online_seconds: 0,
          total_offline_seconds: 0,
          online_sessions: 0,
          offline_sessions: 0,
          uptime_percentage: 0,
          sessions: [],
        };
      }

      if (record.status === "online") {
        analytics[tid].total_online_seconds += record.duration_seconds || 0;
        analytics[tid].online_sessions++;
      } else {
        analytics[tid].total_offline_seconds += record.duration_seconds || 0;
        analytics[tid].offline_sessions++;
      }

      analytics[tid].sessions.push({
        status: record.status,
        changed_at: record.status_changed_at,
        duration_seconds: record.duration_seconds,
        reason: record.reason,
      });
    });

    Object.values(analytics).forEach((terminal) => {
      const totalSeconds =
        terminal.total_online_seconds + terminal.total_offline_seconds;
      terminal.uptime_percentage =
        totalSeconds > 0
          ? Math.round(
              (terminal.total_online_seconds / totalSeconds) * 100 * 100
            ) / 100
          : 0;
      terminal.total_online_hours =
        Math.round((terminal.total_online_seconds / 3600) * 100) / 100;
      terminal.total_offline_hours =
        Math.round((terminal.total_offline_seconds / 3600) * 100) / 100;
    });

    return {
      period: { startDate, endDate },
      terminals: Object.values(analytics),
      total_terminals: Object.keys(analytics).length,
    };
  } catch (error) {
    console.error(`Error getting uptime analytics:`, error.message);
    throw error;
  }
}

async function cleanupPlayingRecordsOnOffline(terminalId) {
  try {
    console.log(
      `🧹 Cleaning up playing records for offline terminal: ${terminalId}`
    );

    // Find all current playing records for this terminal
    const { data: currentPlaying, error: fetchError } = await supabase
      .from("playing")
      .select("*")
      .eq("terminal_id", terminalId)
      .eq("status", "current");

    if (fetchError) {
      throw new Error(
        `Failed to fetch current playing records: ${fetchError.message}`
      );
    }

    if (!currentPlaying || currentPlaying.length === 0) {
      console.log(
        `✅ No current playing records found for terminal ${terminalId}`
      );
      return { cleaned: 0, records: [] };
    }

    const now = new Date().toISOString();
    const cleanedRecords = [];

    // Update each current playing record to completed
    for (const record of currentPlaying) {
      const startedAt = new Date(record.started_at);
      const endedAt = new Date(now);
      const durationSeconds = Math.round((endedAt - startedAt) / 1000);

      const { data: updatedRecord, error: updateError } = await supabase
        .from("playing")
        .update({
          status: "completed",
          ended_at: now,
          duration_seconds: durationSeconds,
        })
        .eq("id", record.id)
        .select()
        .single();

      if (updateError) {
        console.error(
          `❌ Failed to update playing record ${record.id}:`,
          updateError.message
        );
        continue;
      }

      cleanedRecords.push(updatedRecord);
      console.log(
        `✅ Marked playing record ${record.id} as completed (duration: ${durationSeconds}s)`
      );
    }

    console.log(
      `🧹 Cleanup complete: ${cleanedRecords.length} playing records marked as completed`
    );
    return { cleaned: cleanedRecords.length, records: cleanedRecords };
  } catch (error) {
    console.error(
      `Error cleaning up playing records for ${terminalId}:`,
      error.message
    );
    throw error;
  }
}

async function checkAndCleanupOfflineTerminals(terminals) {
  try {
    const cleanupPromises = [];

    for (const terminalData of terminals) {
      const { isOnline } = determineOnlineStatus(terminalData);

      // Only clean up if terminal is offline
      if (!isOnline) {
        console.log(
          `🧹 Terminal ${terminalData.id} is offline, cleaning up playing records`
        );
        cleanupPromises.push(cleanupPlayingRecordsOnOffline(terminalData.id));
      }
    }

    // Execute all cleanup operations in parallel
    const results = await Promise.allSettled(cleanupPromises);

    // Log results
    let totalCleaned = 0;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        totalCleaned += result.value.cleaned;
      } else {
        console.error(
          `❌ Cleanup failed for terminal ${index}:`,
          result.reason
        );
      }
    });

    console.log(
      `🧹 Batch cleanup complete: ${totalCleaned} total playing records marked as completed`
    );
    return { totalCleaned, results };
  } catch (error) {
    console.error(`Error in batch cleanup:`, error.message);
    throw error;
  }
}

module.exports = {
  determineOnlineStatus,
  getCurrentTerminalStatus,
  logTerminalStatusChange,
  updateTerminalStatus,
  getTerminalUptimeAnalytics,
  cleanupPlayingRecordsOnOffline,
  checkAndCleanupOfflineTerminals,
  getMostRecentZone,
};
