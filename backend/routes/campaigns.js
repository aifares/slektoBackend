const express = require("express");
const router = express.Router();

const { supabase } = require("../config/supabase");
const {
  getShareOfVoice,
  getCampaignZoneTime,
  computeOverlapMinutes,
} = require("../services/campaignMetrics");
const { fetchMediaUrlsByProgramAndClient } = require("../services/media");
const { fetchHistoricalTerminals } = require("../services/historicalTerminals");
const { buildZoneCoverageMetrics } = require("../services/zoneCoverage");

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

    // Extract unique program IDs from completed campaigns
    const programIds = Array.from(
      new Set(completedCampaigns.map((c) => c.program_id))
    );

    console.log(
      `Found ${completedCampaigns.length} completed campaigns for client ${client.id}`
    );
    console.log("Program IDs from completed campaigns:", programIds);

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
      console.warn("Failed to fetch terminal metadata:", terminalsError.message);
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
        console.warn("RPC get_latest_terminal_status not available:", error.message);
      }
    }

    // 4. Fetch share of voice for all programs (single query)
    const shareOfVoice = await getShareOfVoice(programIds);

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
        const windowEnd = campaign.completed_at || campaign.end_at; // Use completed_at for analytics date range
        const totalHoursBought = Number(campaign.hours_bought || 0);
        const totalAllowedMinutes = Math.max(0, Math.floor(totalHoursBought * 60));

        // Filter playing sessions for this campaign's program and date range
        const campaignSessions = (allPlayingSessions || []).filter(
          (s) =>
            s.program_id === campaign.program_id &&
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

        // Try to use zone-based calculation via RPC (most accurate)
        const zoneTimeData = await getCampaignZoneTime(
          [campaign.program_id],
          campaignTerminalIds.length > 0 ? campaignTerminalIds : null,
          windowStart,
          windowEnd
        );

        if (zoneTimeData && zoneTimeData[campaign.program_id]) {
          totalMinutesPlayed = zoneTimeData[campaign.program_id].total_minutes_in_zones;
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
        if (shareOfVoice[campaign.program_id] && client.id) {
          const clientShare = shareOfVoice[campaign.program_id][client.id];
          if (clientShare) {
            sharePercent = clientShare.share_percent;
            totalMinutesPlayed = totalMinutesPlayed * sharePercent;
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
          const isOnline = latestStatusByTerminal[terminal.terminalid] === "online";

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

        // Get historical terminals for this campaign's program
        const campaignHistoricalTerminals = allHistoricalTerminals.filter((ht) =>
          ht.programs_played.some((p) => p.program_id === campaign.program_id)
        );

        // Calculate zone coverage for this campaign
        // Use same logic as analytics endpoint: fall back to historical terminals if no terminal IDs from sessions
        const terminalIdsForCoverage =
          campaignTerminalIds.length > 0
            ? campaignTerminalIds
            : Array.from(
                new Set(
                  campaignHistoricalTerminals.map((t) => t.terminal_id)
                )
              );

        // Calculate zone coverage for this campaign - exactly like analytics endpoint
        let zoneCoverageResult = {};
        if (windowStart && terminalIdsForCoverage.length > 0) {
          try {
            // Use full ISO timestamp for start and end (like analytics does)
            const zoneStartDateFinal = windowStart; // Already ISO timestamp
            const zoneEndDateFinal = windowEnd; // Already ISO timestamp

            zoneCoverageResult = await buildZoneCoverageMetrics(
              [campaign.program_id],
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

        // Extract zone coverage for this specific program (handle both string and number keys)
        const programZoneCoverage = 
          zoneCoverageResult[campaign.program_id] || 
          zoneCoverageResult[String(campaign.program_id)] || 
          zoneCoverageResult[Number(campaign.program_id)] ||
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
            media_urls: mediaUrlsByProgram[campaign.program_id] || [],
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

