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
    let totalMinutesPlayed = 0;
    let totalHoursBought = 0;
    for (const c of campaigns) {
      const windowStart = c.start_at;
      const windowEnd =
        new Date() < new Date(c.end_at) ? new Date().toISOString() : c.end_at;
      totalHoursBought += Number(c.hours_bought || 0);
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

    // Get campaign start and end times for this program
    const campaignStartTime =
      campaigns.length > 0 ? campaigns[0].start_at : null;
    const campaignEndTime = campaigns.length > 0 ? campaigns[0].end_at : null;

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
