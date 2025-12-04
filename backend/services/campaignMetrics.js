const { supabase } = require("../config/supabase");
const { fetchMediaUrlsByProgramAndClient } = require("./media");
const {
  getTimeWeightedShare,
  getCurrentShare,
} = require("./shareOfVoiceSnapshots");

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

  // Calculate Share of Voice for all programs (single batch query)
  const shareOfVoice = await getShareOfVoice(programIds);
  const now = new Date();

  // Process each campaign individually to calculate metrics per campaign
  for (const campaign of activeCampaigns) {
    const campaignId = campaign.id;
    const programId = campaign.program_id;
    const windowStart = campaign.start_at;

    // Calculate effective end date:
    // - If campaign is completed: use completed_at
    // - If campaign is active (completed_at is null): use now
    let windowEnd;
    if (campaign.completed_at) {
      // Campaign is completed - only count time up to completion
      windowEnd = campaign.completed_at;
      console.log(
        `📅 [Campaign ${campaignId}] Using completed_at as end date: ${windowEnd}`
      );
    } else {
      // Campaign is active (completed_at is null) - use now
      windowEnd = now.toISOString();
      console.log(
        `📅 [Campaign ${campaignId}] Campaign is active, using now as end date: ${windowEnd}`
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

    if (shareOfVoice[programId] && effectiveClientId) {
      const clientShare = shareOfVoice[programId][effectiveClientId];
      if (clientShare) {
        sharePercent = clientShare.share_percent;
        totalMinutesPlayed = totalMinutesPlayed * sharePercent;
        console.log(
          `📊 [Campaign ${campaignId}] Share of Voice: ${(
            sharePercent * 100
          ).toFixed(1)}% ` +
            `(${clientShare.file_count}/${clientShare.total_files} files)`
        );
        console.log(
          `   Client's adjusted time: ${totalMinutesPlayed.toFixed(2)} minutes`
        );
      } else {
        console.warn(
          `⚠️  [Campaign ${campaignId}] No share data found for client ${effectiveClientId}. ` +
            `Using 100% (may be incorrect if program is shared)`
        );
      }
    } else {
      console.log(
        `ℹ️  [Campaign ${campaignId}] No share of voice calculation (single client or no client_id)`
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
