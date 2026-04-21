const { supabase } = require("../config/supabase");
const { applyTransitionForCampaign } = require("./playlistSchedule");
const { getPlaylistsByCampaignIds } = require("./campaignPlaylists");

/**
 * Find campaign_playlists rows that have reached 100% of their own
 * hours_bought and are not already marked completed.
 *
 * Each playlist is evaluated independently against its own program_id +
 * hours_bought. In rotation mode there's one playlist per campaign
 * (preserves old behavior). In split mode playlists complete on their own
 * schedules; the parent campaign is only marked complete when ALL of its
 * playlists have completed.
 *
 * @returns {Promise<Array>} Completed playlists with campaign + metrics context
 */
async function checkForCompletedPlaylists() {
  try {
    const { data: campaigns, error } = await supabase
      .from("campaign")
      .select("id, client_id, start_at, end_at, status")
      .eq("status", "active");

    if (error) {
      console.error("Error fetching campaigns:", error.message);
      return [];
    }
    if (!campaigns || campaigns.length === 0) return [];

    console.log(
      `🔍 Checking ${campaigns.length} active campaigns (per-playlist)...`
    );

    const { buildCampaignPlaybackMetrics } = require("./campaignMetrics");

    const playlistsByCampaign = await getPlaylistsByCampaignIds(
      campaigns.map((c) => c.id)
    );

    const allProgramIds = [
      ...new Set(
        Object.values(playlistsByCampaign)
          .flat()
          .map((p) => p.program_id)
          .filter(Boolean)
      ),
    ];

    const { data: sessions } = await supabase
      .from("playing")
      .select("terminal_id")
      .in("program_id", allProgramIds.length ? allProgramIds : [-1]);

    const terminalIds = sessions
      ? [...new Set(sessions.map((s) => s.terminal_id))]
      : null;

    const completedPlaylists = [];

    for (const campaign of campaigns) {
      const playlists = playlistsByCampaign[campaign.id] || [];
      if (playlists.length === 0) {
        console.warn(
          `⚠️  Campaign ${campaign.id} has no playlists — skipping`
        );
        continue;
      }

      for (const playlist of playlists) {
        if (playlist.completed_at) continue; // already done

        const metricsInput = {
          ...campaign,
          program_id: playlist.program_id,
          hours_bought: playlist.hours_bought,
        };

        const metrics = await buildCampaignPlaybackMetrics(
          [metricsInput],
          [playlist.program_id],
          terminalIds,
          campaign.client_id
        );

        const m =
          metrics._byCampaign?.[campaign.id] ||
          metrics[playlist.program_id] ||
          null;

        if (!m) {
          console.warn(
            `⚠️  No metrics for playlist ${playlist.id} (campaign ${campaign.id})`
          );
          continue;
        }

        console.log(
          `   [C${campaign.id} P${playlist.id}] ${m.hours_played_since_campaign_start}/${playlist.hours_bought}h (${m.campaign_completion_percent}%)`
        );

        if (m.campaign_completion_percent >= 100) {
          completedPlaylists.push({
            campaign_id: campaign.id,
            playlist_id: playlist.id,
            program_id: playlist.program_id,
            client_id: campaign.client_id,
            completion_percent: m.campaign_completion_percent,
            hours_played: m.hours_played_since_campaign_start,
          });
          console.log(
            `🎯 Playlist ${playlist.id} (campaign ${campaign.id}) COMPLETE`
          );
        }
      }
    }

    console.log(
      `✅ ${completedPlaylists.length} playlists ready for completion`
    );
    return completedPlaylists;
  } catch (err) {
    console.error("Error checking for completed playlists:", err.message);
    return [];
  }
}

/**
 * Complete a single playlist:
 *   1. Mark campaign_playlists.completed_at
 *   2. Apply scheduled transition (ColorLight update + file removal + snapshot)
 *   3. If all of the parent campaign's playlists are now complete,
 *      mark campaign.status='completed' and campaign.completed_at.
 *
 * @param {Object} completed - { campaign_id, playlist_id, program_id, ... }
 */
async function completePlaylist(completed) {
  const results = {
    success: true,
    campaign_id: completed.campaign_id,
    playlist_id: completed.playlist_id,
    program_id: completed.program_id,
    playlist_updated: false,
    campaign_updated: false,
    files_removed: 0,
    snapshot_created: false,
    errors: [],
  };

  try {
    console.log(
      `🏁 Completing playlist ${completed.playlist_id} (campaign ${completed.campaign_id})...`
    );

    const now = new Date().toISOString();

    // Step 1: Mark the playlist completed
    const { error: playlistUpdateError } = await supabase
      .from("campaign_playlists")
      .update({ completed_at: now })
      .eq("id", completed.playlist_id)
      .is("completed_at", null);

    if (playlistUpdateError) {
      throw new Error(
        `Failed to mark playlist complete: ${playlistUpdateError.message}`
      );
    }
    results.playlist_updated = true;

    // Step 2: Apply the scheduled transition for this (campaign, program)
    const transitionResult = await applyTransitionForCampaign(
      completed.campaign_id,
      completed.program_id
    );
    results.files_removed = transitionResult.files_removed || 0;
    results.snapshot_created = transitionResult.snapshot_created || false;
    if (transitionResult.errors?.length) {
      results.errors.push(...transitionResult.errors);
    }

    // Step 3: If every playlist for this campaign is complete, finish the campaign
    const { data: remaining, error: remainingError } = await supabase
      .from("campaign_playlists")
      .select("id")
      .eq("campaign_id", completed.campaign_id)
      .is("completed_at", null);

    if (remainingError) {
      results.errors.push(
        `Failed to check remaining playlists: ${remainingError.message}`
      );
    } else if (!remaining || remaining.length === 0) {
      const { error: campaignUpdateError } = await supabase
        .from("campaign")
        .update({ status: "completed", completed_at: now })
        .eq("id", completed.campaign_id)
        .neq("status", "completed");

      if (campaignUpdateError) {
        results.errors.push(
          `Failed to mark campaign complete: ${campaignUpdateError.message}`
        );
      } else {
        results.campaign_updated = true;
        console.log(
          `🏁 Campaign ${completed.campaign_id} — all playlists complete`
        );
      }
    } else {
      console.log(
        `⏳ Campaign ${completed.campaign_id}: ${remaining.length} playlist(s) still running`
      );
    }

    console.log(`🎉 Playlist ${completed.playlist_id} completion finished`);
  } catch (err) {
    console.error(
      `❌ Error completing playlist ${completed.playlist_id}:`,
      err.message
    );
    results.success = false;
    results.errors.push(err.message);
  }

  return results;
}

/**
 * Mark an entire campaign complete by completing every unfinished playlist.
 * Retained for callers that act at the campaign level (admin cancel,
 * manual-complete endpoints).
 *
 * @param {number} campaignId
 */
async function completeCampaign(campaignId) {
  const results = {
    success: true,
    campaign_id: campaignId,
    playlists_completed: 0,
    files_removed: 0,
    errors: [],
  };

  try {
    const { data: campaign } = await supabase
      .from("campaign")
      .select("id, client_id, status")
      .eq("id", campaignId)
      .single();

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    if (campaign.status === "completed") {
      console.log(`ℹ️  Campaign ${campaignId} already completed`);
      return results;
    }

    const playlistsByCampaign = await getPlaylistsByCampaignIds([campaignId]);
    const playlists = playlistsByCampaign[campaignId] || [];

    for (const p of playlists) {
      if (p.completed_at) continue;
      const r = await completePlaylist({
        campaign_id: campaignId,
        playlist_id: p.id,
        program_id: p.program_id,
        client_id: campaign.client_id,
      });
      if (r.success) {
        results.playlists_completed++;
        results.files_removed += r.files_removed;
      } else {
        results.errors.push(...r.errors);
      }
    }
  } catch (err) {
    console.error(`❌ Error completing campaign ${campaignId}:`, err.message);
    results.success = false;
    results.errors.push(err.message);
  }

  return results;
}

/**
 * Monitor job entry point. Finds playlists at 100% and completes them one by
 * one. The parent campaign is marked completed only when all its playlists
 * have finished.
 */
async function monitorAndAutoComplete() {
  const results = {
    success: true,
    checked_at: new Date().toISOString(),
    playlists_checked: 0,
    playlists_completed: 0,
    campaigns_completed: 0,
    completion_results: [],
    errors: [],
  };

  try {
    console.log("🔍 Checking for playlists at 100% completion...");

    const completed = await checkForCompletedPlaylists();
    results.playlists_checked = completed.length;

    if (completed.length === 0) {
      console.log("ℹ️  No playlists ready for completion");
      return results;
    }

    for (const item of completed) {
      const r = await completePlaylist(item);
      results.completion_results.push(r);
      if (r.success) {
        results.playlists_completed++;
        if (r.campaign_updated) results.campaigns_completed++;
      } else {
        results.errors.push(
          `Playlist ${item.playlist_id} (C${item.campaign_id}): ${r.errors.join(", ")}`
        );
      }
    }

    console.log(
      `🎉 Auto-completion: ${results.playlists_completed}/${completed.length} playlists, ${results.campaigns_completed} campaigns finished`
    );
  } catch (err) {
    console.error("❌ Error in auto-completion monitor:", err.message);
    results.success = false;
    results.errors.push(err.message);
  }

  return results;
}

module.exports = {
  checkForCompletedPlaylists,
  completePlaylist,
  completeCampaign,
  monitorAndAutoComplete,
  // legacy exports kept for any callers referencing the old names
  checkForCompletedCampaigns: checkForCompletedPlaylists,
};
