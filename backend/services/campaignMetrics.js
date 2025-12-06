const { supabase } = require("../config/supabase");
const { fetchMediaUrlsByProgramAndClient } = require("./media");
const { getCurrentShare } = require("./shareOfVoiceSnapshots");

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
        console.log(
          `📊 [RPC] Time-weighted share for program ${programId}, client ${clientId}: ${data}%`
        );
        return shareDecimal;
      }
    }

    // Fallback to current share if RPC returns null or no snapshots exist
    console.log(
      `ℹ️  No snapshots found for program ${programId}, client ${clientId} - using current share`
    );
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

function computeOverlapMinutes(
  sessionStartIso,
  sessionEndIso,
  windowStartIso,
  windowEndIso
) {
  const sessionStart = new Date(sessionStartIso);
  const sessionEnd = new Date(sessionEndIso || new Date().toISOString());
  const windowStart = new Date(windowStartIso);
  const windowEnd = new Date(windowEndIso);
  const start = sessionStart > windowStart ? sessionStart : windowStart;
  const end = sessionEnd < windowEnd ? sessionEnd : windowEnd;
  const ms = end - start;
  return ms > 0 ? Math.floor(ms / 60000) : 0;
}

/**
 * Calculate Share of Voice for multiple programs
 * Returns percentage of files in each program that belong to each client
 *
 * @param {Array<number>} programIds - Array of program IDs to calculate shares for
 * @returns {Object} Map of program_id -> client_id -> share_percent
 */
async function getShareOfVoice(programIds) {
  try {
    // Query to get file count per client per program (only active files)
    const { data, error } = await supabase
      .from("files")
      .select("program_id, client_id")
      .in("program_id", programIds)
      .is("removed_at", null); // Only count files that haven't been removed

    if (error) {
      console.error("[Share of Voice] Error querying files:", error.message);
      return {};
    }

    // Calculate share per program per client
    const shareByProgram = {};

    // Group by program
    const programGroups = {};
    for (const row of data || []) {
      const programId = row.program_id;
      if (!programGroups[programId]) {
        programGroups[programId] = [];
      }
      // Only count files that have a client_id
      if (row.client_id) {
        programGroups[programId].push(row.client_id);
      }
    }

    // Calculate percentages
    for (const [programId, clientIds] of Object.entries(programGroups)) {
      const totalCount = clientIds.length;
      const clientCounts = {};

      // Count files per client
      for (const clientId of clientIds) {
        clientCounts[clientId] = (clientCounts[clientId] || 0) + 1;
      }

      // Calculate percentages
      shareByProgram[programId] = {};
      for (const [clientId, count] of Object.entries(clientCounts)) {
        shareByProgram[programId][clientId] = {
          file_count: count,
          total_files: totalCount,
          share_percent: totalCount > 0 ? count / totalCount : 0,
        };
      }
    }

    console.log(
      `✅ [Share of Voice] Calculated current share for ${
        Object.keys(shareByProgram).length
      } programs (real-time fallback)`
    );
    return shareByProgram;
  } catch (error) {
    console.error("[Share of Voice] Error calculating share:", error.message);
    return {};
  }
}

async function getCampaignZoneTime(
  programIds,
  terminalIds,
  startTime,
  endTime
) {
  try {
    const { data, error } = await supabase.rpc("get_campaign_zone_time", {
      p_program_ids: programIds,
      p_terminal_ids: terminalIds,
      p_start_time: startTime,
      p_end_time: endTime,
    });

    if (error) {
      console.warn(
        `[Campaign Metrics] RPC function not found or error, using fallback:`,
        error.message
      );
      return null; // Signal fallback needed
    }

    console.log(
      `✅ [Campaign Metrics] Using zone-based calculation via RPC (${
        data?.length || 0
      } programs)`
    );

    // Convert array result to map by program_id
    const resultMap = {};
    (data || []).forEach((row) => {
      resultMap[row.program_id] = {
        total_minutes_in_zones: parseFloat(row.total_minutes_in_zones) || 0,
        total_hours_in_zones: parseFloat(row.total_hours_in_zones) || 0,
        terminal_count: row.terminal_count || 0,
      };
    });

    return resultMap;
  } catch (error) {
    console.error(`[Campaign Metrics] Error calling RPC:`, error.message);
    return null; // Signal fallback needed
  }
}

async function buildCampaignPlaybackMetrics(
  activeCampaigns,
  programIds,
  terminalIds = null,
  clientId = null
) {
  const playbackMetricsByCampaign = {};
  const playbackMetricsByProgram = {}; // Keep for backward compatibility with other callers

  if (!activeCampaigns || activeCampaigns.length === 0) {
    // Always initialize _byCampaign even when empty (for internal services like campaignCompletion)
    playbackMetricsByProgram._byCampaign = playbackMetricsByCampaign;
    return playbackMetricsByProgram;
  }

  const now = new Date();

  // Process each campaign individually to calculate metrics per campaign
  for (const campaign of activeCampaigns) {
    const campaignId = campaign.id;
    const programId = campaign.program_id;
    const windowStart = campaign.start_at;

    // Calculate effective end date:
    // - If campaign has completed_at AND it's before end_at: use completed_at (completed early)
    // - If campaign has completed_at BUT it's after end_at: use end_at (ran full duration)
    // - If no completed_at but past end_at: use end_at (should have ended)
    // - If no completed_at and before end_at: use now (still active)
    let windowEnd;
    const endAt = new Date(campaign.end_at);
    const completedAt = campaign.completed_at
      ? new Date(campaign.completed_at)
      : null;

    if (completedAt && completedAt < endAt) {
      // Campaign completed early - use completed_at
      windowEnd = campaign.completed_at;
      console.log(
        `📅 [Campaign ${campaignId}] Completed early, using completed_at: ${windowEnd}`
      );
    } else if (endAt <= now) {
      // Campaign has reached or passed its end date - use end_at
      windowEnd = campaign.end_at;
      console.log(
        `📅 [Campaign ${campaignId}] Past end date, using end_at: ${windowEnd}`
      );
    } else {
      // Campaign is still active - use now
      windowEnd = now.toISOString();
      console.log(
        `📅 [Campaign ${campaignId}] Still active, using now: ${windowEnd}`
      );
    }

    const totalHoursBought = Number(campaign.hours_bought || 0);

    // Calculate total minutes played within this campaign's window
    let totalMinutesPlayed = 0;
    let sharePercent = 1.0; // Default to 100% if no share data

    // Try to use zone-based calculation via RPC (call per campaign with specific dates)
    // Only attempt if we have terminal IDs, otherwise skip to ensure we still return campaign info
    if (terminalIds && terminalIds.length > 0) {
      const zoneTimeData = await getCampaignZoneTime(
        [programId], // Single program
        terminalIds,
        windowStart, // Campaign-specific start date
        windowEnd // Campaign-specific end date (or now)
      );

      // Use zone-based calculation if available (more accurate)
      if (zoneTimeData && zoneTimeData[programId]) {
        totalMinutesPlayed = zoneTimeData[programId].total_minutes_in_zones;
        console.log(
          `✅ [Campaign ${campaignId}] Using zone-based time: ${totalMinutesPlayed.toFixed(
            2
          )} minutes (from ${windowStart} to ${windowEnd})`
        );
      } else {
        // Fallback to playing table calculation (may include non-zone time)
        console.log(
          `⚠️  [Campaign ${campaignId}] Using fallback (playing table) - may include non-zone time`
        );

        // Fetch sessions for this specific campaign window
        const nowForQuery = new Date().toISOString();
        const { data: sessions, error: sessionsError } = await supabase
          .from("playing")
          .select("program_id, started_at, ended_at, status")
          .eq("program_id", programId)
          .lte("started_at", nowForQuery)
          .or(`ended_at.gte.${windowStart},ended_at.is.null`);

        if (sessionsError) {
          console.warn(
            `Failed to fetch sessions for campaign ${campaignId}:`,
            sessionsError.message
          );
        } else {
          for (const s of sessions || []) {
            totalMinutesPlayed += computeOverlapMinutes(
              s.started_at,
              s.ended_at,
              windowStart,
              windowEnd
            );
          }
        }
      }
    } else {
      // No terminals have played yet - this is fine, we'll return campaign info with zero playback
      console.log(
        `ℹ️  [Campaign ${campaignId}] No terminals have played yet - returning campaign info with zero playback`
      );
    }

    // Apply Share of Voice if available
    // Use the clientId parameter (from auth) or fall back to campaign.client_id
    const effectiveClientId = clientId || campaign.client_id;

    if (effectiveClientId) {
      // Get time-weighted share for this campaign's specific date range using RPC
      sharePercent = await getShareForDateRange(
        programId,
        effectiveClientId,
        windowStart,
        windowEnd
      );

      if (sharePercent > 0 && sharePercent <= 1) {
        // Valid share - apply it to playback time
        totalMinutesPlayed = totalMinutesPlayed * sharePercent;
        console.log(
          `📊 [Campaign ${campaignId}] Time-weighted Share of Voice: ${(
            sharePercent * 100
          ).toFixed(1)}% (from ${windowStart} to ${windowEnd})`
        );
        console.log(
          `   Client's adjusted time: ${totalMinutesPlayed.toFixed(2)} minutes`
        );
      } else if (sharePercent === 0) {
        // Share is 0 - client has no files in the program
        // This could mean: files were removed, or campaign was never allocated files
        // Set playback time to 0 - they haven't earned any time
        totalMinutesPlayed = 0;
        console.warn(
          `⚠️  [Campaign ${campaignId}] Share is 0% for client ${effectiveClientId}. ` +
            `Client has no active files in program - playback time set to 0`
        );
      } else {
        // Invalid share (negative or > 1) - this shouldn't happen, log error but continue
        console.error(
          `❌ [Campaign ${campaignId}] Invalid share value ${sharePercent} for client ${effectiveClientId}. ` +
            `This is unexpected - check share calculation. Using 100% as fallback.`
        );
        sharePercent = 1.0;
      }
    } else {
      console.log(
        `ℹ️  [Campaign ${campaignId}] No share of voice calculation (no client_id)`
      );
    }

    const totalAllowedMinutes = Math.max(0, Math.floor(totalHoursBought * 60));
    const completionPercent =
      totalAllowedMinutes > 0
        ? Math.min(
            100,
            Math.round((totalMinutesPlayed / totalAllowedMinutes) * 100)
          )
        : 0;

    // Get campaign start and end times
    const campaignStartTime = campaign.start_at;
    const campaignEndTime = campaign.end_at;
    const campaignCompletedAt = campaign.completed_at || null;

    // Fetch media URLs for this program and client
    const mediaUrls = await fetchMediaUrlsByProgramAndClient(
      programId,
      effectiveClientId
    );

    const campaignMetrics = {
      minutes_played_since_campaign_start: totalMinutesPlayed,
      hours_played_since_campaign_start: Number(
        (totalMinutesPlayed / 60).toFixed(2)
      ),
      campaign_hours_bought: totalHoursBought,
      campaign_minutes_bought: totalAllowedMinutes,
      campaign_completion_percent: completionPercent,
      campaign_start_at: campaignStartTime,
      campaign_end_at: campaignEndTime,
      campaign_completed_at: campaignCompletedAt, // When campaign was actually completed
      share_of_voice_percent:
        sharePercent > 0 ? Number((sharePercent * 100).toFixed(1)) : null,
      media_urls: mediaUrls, // Array of image URLs for this client's campaign
    };

    // Store by campaign_id for accurate per-campaign lookups
    playbackMetricsByCampaign[campaignId] = campaignMetrics;

    // Also store by program_id for backward compatibility (use the last campaign for that program)
    // This maintains compatibility with other code that looks up by program_id
    playbackMetricsByProgram[programId] = campaignMetrics;
  }

  // Attach campaign-level metrics to the return object for new callers
  playbackMetricsByProgram._byCampaign = playbackMetricsByCampaign;

  return playbackMetricsByProgram;
}

module.exports = {
  buildCampaignPlaybackMetrics,
  getShareOfVoice,
  getCampaignZoneTime,
  computeOverlapMinutes,
};
