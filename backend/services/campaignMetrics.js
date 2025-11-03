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

async function buildCampaignPlaybackMetrics(activeCampaigns, programIds) {
  const campaignsByProgram = new Map();
  let minCampaignStartIso = null;
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
  }

  const playbackMetricsByProgram = {};
  if (!minCampaignStartIso) return playbackMetricsByProgram;

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
    const sessions = sessionsByProgram.get(programId) || [];
    
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
    for (const s of sessions) {
      totalMinutesPlayed += computeOverlapMinutes(
        s.started_at,
        s.ended_at,
        windowStart,
        windowEnd
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
