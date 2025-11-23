const { supabase } = require("../config/supabase");

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

async function getCampaignZoneTime(programIds, terminalIds, startTime, endTime) {
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
      `✅ [Campaign Metrics] Using zone-based calculation via RPC (${data?.length || 0} programs)`
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
    console.error(
      `[Campaign Metrics] Error calling RPC:`,
      error.message
    );
    return null; // Signal fallback needed
  }
}

async function buildCampaignPlaybackMetrics(activeCampaigns, programIds, terminalIds = null) {
  const campaignsByProgram = new Map();
  let minCampaignStartIso = null;
  let maxCampaignEndIso = null;
  
  for (const c of activeCampaigns || []) {
    const list = campaignsByProgram.get(c.program_id) || [];
    list.push(c);
    campaignsByProgram.set(c.program_id, list);
    if (
      !minCampaignStartIso ||
      new Date(c.start_at) < new Date(minCampaignStartIso)
    ) {
      minCampaignStartIso = c.start_at;
    }
    if (
      !maxCampaignEndIso ||
      new Date(c.end_at) > new Date(maxCampaignEndIso)
    ) {
      maxCampaignEndIso = c.end_at;
    }
  }

  const playbackMetricsByProgram = {};
  if (!minCampaignStartIso) return playbackMetricsByProgram;
  
  // Try to use zone-based calculation via RPC
  const zoneTimeData = await getCampaignZoneTime(
    programIds,
    terminalIds,
    minCampaignStartIso,
    maxCampaignEndIso || new Date().toISOString()
  );

  const nowForQuery = new Date().toISOString();
  const { data: allSessions, error: allSessionsError } = await supabase
    .from("playing")
    .select("program_id, started_at, ended_at, status")
    .in("program_id", programIds)
    .lte("started_at", nowForQuery)
    .or(`ended_at.gte.${minCampaignStartIso},ended_at.is.null`);

  if (allSessionsError) {
    console.warn(
      "Failed to fetch sessions for campaign metrics:",
      allSessionsError.message
    );
    return playbackMetricsByProgram;
  }

  const sessionsByProgram = new Map();
  for (const s of allSessions || []) {
    const list = sessionsByProgram.get(s.program_id) || [];
    list.push(s);
    sessionsByProgram.set(s.program_id, list);
  }

  for (const [programId, campaigns] of campaignsByProgram.entries()) {
    // Each campaign is separate - select the campaign associated with the client
    // Priority: 1) Currently active campaign, 2) Most recent active campaign, 3) Earliest campaign
    const now = new Date();
    let selectedCampaign = null;
    
    // First, try to find an active campaign (isActive = true)
    const activeCampaign = campaigns.find((c) => c.isActive);
    if (activeCampaign) {
      selectedCampaign = activeCampaign;
    } else {
      // No active campaign - find the most recent one that has started (or earliest if none started)
      const startedCampaigns = campaigns.filter(
        (c) => new Date(c.start_at) <= now
      );
      
      if (startedCampaigns.length > 0) {
        // Use the most recent start date among started campaigns
        selectedCampaign = startedCampaigns.reduce((latest, current) => {
          return new Date(current.start_at) > new Date(latest.start_at)
            ? current
            : latest;
        });
      } else {
        // None have started yet - use earliest start date
        selectedCampaign = campaigns.reduce((earliest, current) => {
          return new Date(current.start_at) < new Date(earliest.start_at)
            ? current
            : earliest;
        });
      }
    }
    
    if (!selectedCampaign) continue;
    
    const windowStart = selectedCampaign.start_at;
    const windowEnd =
      now < new Date(selectedCampaign.end_at)
        ? now.toISOString()
        : selectedCampaign.end_at;
    
    const totalHoursBought = Number(selectedCampaign.hours_bought || 0);
    
    // Calculate total minutes played within this campaign's window
    let totalMinutesPlayed = 0;
    
    // Use zone-based calculation if available (more accurate)
    if (zoneTimeData && zoneTimeData[programId]) {
      totalMinutesPlayed = zoneTimeData[programId].total_minutes_in_zones;
      console.log(
        `✅ [Campaign ${programId}] Using zone-based time: ${totalMinutesPlayed.toFixed(2)} minutes`
      );
    } else {
      // Fallback to playing table calculation (may include non-zone time)
      console.log(
        `⚠️  [Campaign ${programId}] Using fallback (playing table) - may include non-zone time`
      );
      const sessions = sessionsByProgram.get(programId) || [];
      for (const s of sessions) {
        totalMinutesPlayed += computeOverlapMinutes(
          s.started_at,
          s.ended_at,
          windowStart,
          windowEnd
        );
      }
    }

    const totalAllowedMinutes = Math.max(0, Math.floor(totalHoursBought * 60));
    const completionPercent =
      totalAllowedMinutes > 0
        ? Math.min(
            100,
            Math.round((totalMinutesPlayed / totalAllowedMinutes) * 100)
          )
        : 0;

    // Get campaign start and end times for this program (selected campaign)
    const campaignStartTime = selectedCampaign.start_at;
    const campaignEndTime = selectedCampaign.end_at;

    playbackMetricsByProgram[programId] = {
      minutes_played_since_campaign_start: totalMinutesPlayed,
      hours_played_since_campaign_start: Number(
        (totalMinutesPlayed / 60).toFixed(2)
      ),
      campaign_hours_bought: totalHoursBought,
      campaign_minutes_bought: totalAllowedMinutes,
      campaign_completion_percent: completionPercent,
      campaign_start_at: campaignStartTime,
      campaign_end_at: campaignEndTime,
    };
  }

  return playbackMetricsByProgram;
}

module.exports = { buildCampaignPlaybackMetrics };
