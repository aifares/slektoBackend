const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");
const {
  getCampaignZoneTime,
  computeOverlapMinutes,
} = require("../services/campaignMetrics");
const { fetchMediaUrlsByProgramAndClient } = require("../services/media");
const { fetchHistoricalTerminals } = require("../services/historicalTerminals");
const {
  buildZoneCoverageMetrics,
  mergeZoneCoverageForSplitCampaigns,
} = require("../services/zoneCoverage");
const { getCurrentShare } = require("../services/shareOfVoiceSnapshots");
const { getPlaylistsByCampaignIds } = require("../services/campaignPlaylists");

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
 * GET /campaigns/past
 * Returns all completed campaigns for the authenticated user with full analytics metrics
 * Optimized to batch database queries for better performance
 */
router.get("/past", async (req, res) => {
  try {
    const client = req.client; // set by auth middleware

    // Fetch all completed campaigns for this client
    // Filter purely by status field - no date-based filtering
    const { data: completedCampaigns, error: campaignsError } = await supabase
      .from("campaign")
      .select("*")
      .eq("client_id", client.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false }); // Most recently completed first

    if (campaignsError) {
      return res.status(500).json({
        error: "Failed to fetch completed campaigns",
        details: campaignsError.message,
      });
    }

    // If no completed campaigns, return empty array
    if (!completedCampaigns || completedCampaigns.length === 0) {
      return res.json({
        success: true,
        campaigns: [],
        count: 0,
      });
    }

    // Fetch sibling playlist program_ids for every campaign so split-mode
    // campaigns aggregate across all their playlists (not just the rollup
    // program_id on the campaign row). Every campaign has at least one
    // campaign_playlists row after migration 028.
    const campaignIds = completedCampaigns.map((c) => c.id);
    let playlistsByCampaign = {};
    try {
      playlistsByCampaign = await getPlaylistsByCampaignIds(campaignIds);
    } catch (err) {
      console.warn(
        "Failed to fetch campaign_playlists (falling back to rollup program_id):",
        err.message
      );
    }

    // Per-campaign sibling program_ids. Primary is always campaign.program_id
    // so that the response is keyed consistently with other endpoints.
    const siblingProgramIdsByCampaign = {};
    for (const c of completedCampaigns) {
      const fromPlaylists = (playlistsByCampaign[c.id] || [])
        .map((p) => p.program_id)
        .filter(Boolean);
      const set = new Set([c.program_id, ...fromPlaylists]);
      siblingProgramIdsByCampaign[c.id] = Array.from(set);
    }

    // Union of every program_id we might need to query for (rollup + siblings)
    const programIds = Array.from(
      new Set(
        Object.values(siblingProgramIdsByCampaign).flat()
      )
    );

    console.log(
      `Found ${completedCampaigns.length} completed campaigns for client ${client.id}`
    );
    console.log("Program IDs from completed campaigns (incl. siblings):", programIds);

    // ===== BATCH ALL DATABASE QUERIES =====
    // 1. Fetch playing sessions for all programs (single query) - include all fields needed
    const { data: allPlayingSessions, error: allPlayingError } = await supabase
      .from("playing")
      .select(
        "terminal_id, program_id, program_name, file_name, source, started_at, ended_at, status"
      )
      .in("program_id", programIds);

    if (allPlayingError) {
      console.warn(
        "Failed to fetch playing sessions:",
        allPlayingError.message
      );
    }

    // Extract terminal IDs from playing sessions
    const terminalIds = Array.from(
      new Set((allPlayingSessions || []).map((s) => s.terminal_id))
    );

    // 2. Fetch terminal metadata (for all terminals that played these programs)
    const { data: terminalRows, error: terminalsError } = await supabase
      .from("terminals")
      .select("terminalid, name, group_name, last_report_time, power_status")
      .in("terminalid", terminalIds.length > 0 ? terminalIds : []);

    if (terminalsError) {
      console.warn(
        "Failed to fetch terminal metadata:",
        terminalsError.message
      );
    }

    // 3. Fetch terminal online status from terminal_status_log (if RPC exists)
    let latestStatusByTerminal = {};
    if (terminalIds.length > 0) {
      try {
        const { data: terminalStatusRows, error: statusError } =
          await supabase.rpc("get_latest_terminal_status", {
            p_terminal_ids: terminalIds,
          });

        if (!statusError && terminalStatusRows) {
          for (const statusRow of terminalStatusRows) {
            latestStatusByTerminal[statusRow.terminal_id] = statusRow.status;
          }
        }
      } catch (error) {
        console.warn(
          "RPC get_latest_terminal_status not available:",
          error.message
        );
      }
    }

    // Share of voice will be calculated per campaign with date ranges using RPC

    // 5. Fetch media URLs for all programs (batch queries)
    const mediaUrlsByProgram = {};
    await Promise.all(
      programIds.map(async (programId) => {
        const urls = await fetchMediaUrlsByProgramAndClient(
          programId,
          client.id
        );
        mediaUrlsByProgram[programId] = urls;
      })
    );

    // 6. Fetch historical terminals for all programs
    let allHistoricalTerminals = [];
    try {
      allHistoricalTerminals = await fetchHistoricalTerminals(programIds);
    } catch (error) {
      console.warn("Failed to fetch historical terminals data:", error.message);
    }

    // ===== CALCULATE METRICS FOR EACH CAMPAIGN =====
    const campaignsWithMetrics = await Promise.all(
      completedCampaigns.map(async (campaign) => {
        const windowStart = campaign.start_at;

        // Calculate effective end date:
        // - If campaign has completed_at AND it's before end_at: use completed_at (completed early)
        // - If campaign has completed_at BUT it's after end_at: use end_at (ran full duration)
        // - Otherwise: use end_at (campaign ended normally)
        const now = new Date();
        const endAt = new Date(campaign.end_at);
        const completedAt = campaign.completed_at
          ? new Date(campaign.completed_at)
          : null;

        let windowEnd;
        if (completedAt && completedAt < endAt) {
          // Campaign completed early
          windowEnd = campaign.completed_at;
        } else {
          // Campaign ran full duration or no completed_at
          windowEnd = campaign.end_at;
        }

        const totalHoursBought = Number(campaign.hours_bought || 0);
        const totalAllowedMinutes = Math.max(
          0,
          Math.floor(totalHoursBought * 60)
        );

        // All program_ids that belong to this campaign (split-mode = many).
        const siblingProgramIds =
          siblingProgramIdsByCampaign[campaign.id] &&
          siblingProgramIdsByCampaign[campaign.id].length > 0
            ? siblingProgramIdsByCampaign[campaign.id]
            : [campaign.program_id];
        const siblingProgramIdSet = new Set(siblingProgramIds);

        // Filter playing sessions for any of this campaign's playlists and date range
        const campaignSessions = (allPlayingSessions || []).filter(
          (s) =>
            siblingProgramIdSet.has(s.program_id) &&
            s.started_at <= windowEnd &&
            (s.ended_at === null || s.ended_at >= windowStart)
        );

        // Filter sessions that were active during campaign window
        const sessionsDuringCampaign = campaignSessions.filter((s) => {
          const sessionStart = new Date(s.started_at);
          const sessionEnd = s.ended_at ? new Date(s.ended_at) : new Date();
          const campaignStart = new Date(windowStart);
          const campaignEnd = new Date(windowEnd);
          return sessionStart <= campaignEnd && sessionEnd >= campaignStart;
        });

        // Get terminal IDs that played during this campaign
        const campaignTerminalIds = Array.from(
          new Set(sessionsDuringCampaign.map((s) => s.terminal_id))
        );

        // Calculate total minutes played within this campaign's window
        let totalMinutesPlayed = 0;
        let sharePercent = 1.0; // Default to 100% if no share data

        // Try to use zone-based calculation via RPC (most accurate).
        // Pass all sibling program_ids so split-mode campaigns aggregate
        // time across every playlist (not just the rollup program_id).
        const zoneTimeData = await getCampaignZoneTime(
          siblingProgramIds,
          campaignTerminalIds.length > 0 ? campaignTerminalIds : null,
          windowStart,
          windowEnd
        );

        if (zoneTimeData) {
          // Sum across every sibling program_id the RPC returned
          let summed = 0;
          let matched = false;
          for (const pid of siblingProgramIds) {
            const row = zoneTimeData[pid] || zoneTimeData[String(pid)];
            if (row) {
              summed += Number(row.total_minutes_in_zones) || 0;
              matched = true;
            }
          }
          if (matched) {
            totalMinutesPlayed = summed;
          } else {
            for (const session of sessionsDuringCampaign) {
              totalMinutesPlayed += computeOverlapMinutes(
                session.started_at,
                session.ended_at,
                windowStart,
                windowEnd
              );
            }
          }
        } else {
          // Fallback to playing table calculation
          for (const session of sessionsDuringCampaign) {
            totalMinutesPlayed += computeOverlapMinutes(
              session.started_at,
              session.ended_at,
              windowStart,
              windowEnd
            );
          }
        }

        // Apply Share of Voice if available
        if (client.id) {
          // Get time-weighted share for this campaign's specific date range using RPC
          sharePercent = await getShareForDateRange(
            campaign.program_id,
            client.id,
            windowStart,
            windowEnd
          );

          if (sharePercent > 0 && sharePercent <= 1) {
            totalMinutesPlayed = totalMinutesPlayed * sharePercent;
            console.log(
              `📊 [Past Campaign ${
                campaign.id
              }] Time-weighted Share of Voice: ${(sharePercent * 100).toFixed(
                1
              )}% (from ${windowStart} to ${windowEnd})`
            );
          } else if (sharePercent === 0) {
            // Share is 0 - client has no files in the program
            totalMinutesPlayed = 0;
            console.warn(
              `⚠️  [Past Campaign ${campaign.id}] Share is 0% for client ${client.id}. ` +
                `Client has no active files in program - playback time set to 0`
            );
          } else {
            // Invalid share (negative or > 1)
            console.error(
              `❌ [Past Campaign ${campaign.id}] Invalid share value ${sharePercent}. Using 100% as fallback.`
            );
            sharePercent = 1.0;
          }
        }

        const completionPercent =
          totalAllowedMinutes > 0
            ? Math.min(
                100,
                Math.round((totalMinutesPlayed / totalAllowedMinutes) * 100)
              )
            : 0;

        // Build terminals list for this campaign (terminals that played during campaign)
        const terminalsForCampaign = (terminalRows || []).filter((t) =>
          campaignTerminalIds.includes(t.terminalid)
        );

        const playingByTerminalId = Object.fromEntries(
          sessionsDuringCampaign
            .filter((s) => s.status === "current" || !s.ended_at)
            .map((s) => [s.terminal_id, s])
        );

        const terminalsOut = terminalsForCampaign.map((terminal) => {
          const playing = playingByTerminalId[terminal.terminalid] || null;
          const isOnline =
            latestStatusByTerminal[terminal.terminalid] === "online";

          return {
            terminalId: terminal.terminalid,
            name: terminal.name || null,
            group_name: terminal.group_name || null,
            last_report_time: terminal.last_report_time || null,
            power_status: terminal.power_status || null,
            isOnline: isOnline,
            playing: playing
              ? {
                  program_id: playing.program_id,
                  program_name: playing.program_name,
                  file_name: playing.file_name,
                  source: playing.source,
                  started_at: playing.started_at,
                }
              : null,
          };
        });

        // Calculate summary statistics for this campaign
        const terminalsPlayingCount = sessionsDuringCampaign.filter(
          (s) => s.status === "current" || !s.ended_at
        ).length;
        const offlineCount = terminalsForCampaign.filter(
          (t) => t.power_status === "off"
        ).length;

        // Get historical terminals for any of this campaign's sibling programs
        const campaignHistoricalTerminals = allHistoricalTerminals.filter(
          (ht) =>
            ht.programs_played.some((p) =>
              siblingProgramIdSet.has(p.program_id)
            )
        );

        // Calculate zone coverage for this campaign
        // Use same logic as analytics endpoint: fall back to historical terminals if no terminal IDs from sessions
        const terminalIdsForCoverage =
          campaignTerminalIds.length > 0
            ? campaignTerminalIds
            : Array.from(
                new Set(campaignHistoricalTerminals.map((t) => t.terminal_id))
              );

        // Calculate zone coverage for this campaign - pass all sibling
        // program_ids so split-mode campaigns aggregate across every playlist.
        let zoneCoverageResult = {};
        if (windowStart && terminalIdsForCoverage.length > 0) {
          try {
            // Use full ISO timestamp for start and end (like analytics does)
            const zoneStartDateFinal = windowStart; // Already ISO timestamp
            const zoneEndDateFinal = windowEnd; // Already ISO timestamp

            zoneCoverageResult = await buildZoneCoverageMetrics(
              siblingProgramIds,
              terminalIdsForCoverage,
              zoneStartDateFinal,
              zoneEndDateFinal,
              50, // zoneLimit
              client.id // Pass client_id for share of voice calculation
            );
          } catch (error) {
            console.warn(
              `Failed to build zone coverage for campaign ${campaign.id}:`,
              error.message
            );
          }
        }

        // Merge sibling playlists into one zone-coverage entry keyed under the
        // campaign's primary program_id, so split-mode campaigns behave like
        // rotation-mode (one card per campaign).
        const mergedZoneCoverage = mergeZoneCoverageForSplitCampaigns(
          zoneCoverageResult,
          [
            {
              primaryProgramId: campaign.program_id,
              programIds: siblingProgramIds,
            },
          ]
        );

        const programZoneCoverage =
          mergedZoneCoverage[campaign.program_id] ||
          mergedZoneCoverage[String(campaign.program_id)] ||
          mergedZoneCoverage[Number(campaign.program_id)] ||
          {};

        return {
          id: campaign.id,
          client_id: campaign.client_id,
          program_id: campaign.program_id,
          hours_bought: campaign.hours_bought,
          minutes_bought: totalAllowedMinutes,
          start_at: campaign.start_at,
          end_at: campaign.end_at,
          status: campaign.status,
          completed_at: campaign.completed_at,
          created_at: campaign.created_at,
          metrics: {
            minutes_played_since_campaign_start: totalMinutesPlayed,
            hours_played_since_campaign_start: Number(
              (totalMinutesPlayed / 60).toFixed(2)
            ),
            campaign_hours_bought: totalHoursBought,
            campaign_minutes_bought: totalAllowedMinutes,
            campaign_completion_percent: completionPercent,
            campaign_start_at: windowStart,
            campaign_end_at: windowEnd,
            share_of_voice_percent:
              sharePercent > 0 ? Number((sharePercent * 100).toFixed(1)) : null,
            media_urls: Array.from(
              new Set(
                siblingProgramIds.flatMap(
                  (pid) => mediaUrlsByProgram[pid] || []
                )
              )
            ),
            program_ids: siblingProgramIds,
          },
          terminals: terminalsOut,
          summary: {
            total_terminals: terminalsOut.length,
            terminals_playing: terminalsPlayingCount,
            terminals_offline: offlineCount,
            historical_terminals_count: campaignHistoricalTerminals.length,
          },
          historical_terminals: campaignHistoricalTerminals,
          zone_coverage: programZoneCoverage,
        };
      })
    );

    return res.json({
      success: true,
      campaigns: campaignsWithMetrics,
      count: campaignsWithMetrics.length,
    });
  } catch (error) {
    console.error("❌ Error fetching past campaigns:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch past campaigns",
      details: error.message,
    });
  }
});

module.exports = router;
