const { supabase } = require("../config/supabase");
const { applyTransitionForCampaign } = require("./playlistSchedule");

/**
 * Check for campaigns that have reached 100% completion
 * Each campaign is checked individually with its own client_id to ensure
 * share of voice is applied correctly per campaign
 * @returns {Promise<Array>} List of completed campaigns
 */
async function checkForCompletedCampaigns() {
  try {
    // Get all active campaigns
    const { data: campaigns, error } = await supabase
      .from("campaign")
      .select(
        "id, client_id, program_id, start_at, end_at, hours_bought, status",
      )
      .eq("status", "active");

    if (error) {
      console.error("Error fetching campaigns:", error.message);
      return [];
    }

    if (!campaigns || campaigns.length === 0) {
      return [];
    }

    console.log(
      `🔍 Checking ${campaigns.length} active campaigns for completion...`,
    );

    const { buildCampaignPlaybackMetrics } = require("./campaignMetrics");

    const programIds = [...new Set(campaigns.map((c) => c.program_id))];

    // Get all terminal IDs for these programs
    const { data: sessions } = await supabase
      .from("playing")
      .select("terminal_id")
      .in("program_id", programIds);

    const terminalIds = sessions
      ? [...new Set(sessions.map((s) => s.terminal_id))]
      : null;

    // Find campaigns at 100%+
    const completedCampaigns = [];

    // Process each campaign INDIVIDUALLY to ensure correct share of voice per campaign
    for (const campaign of campaigns) {
      const now = new Date();
      const campaignWithStatus = {
        ...campaign,
        isActive:
          new Date(campaign.start_at) <= now &&
          new Date(campaign.end_at) >= now,
      };

      console.log(
        `\n📊 Checking campaign ${campaign.id} (Client ${campaign.client_id}, Program ${campaign.program_id}, Hours bought: ${campaign.hours_bought})...`,
      );

      // Calculate metrics for THIS SPECIFIC campaign with its client_id
      // This ensures share of voice is calculated for THIS client only
      const metrics = await buildCampaignPlaybackMetrics(
        [campaignWithStatus], // Single campaign
        [campaign.program_id], // Single program
        terminalIds,
        campaign.client_id, // IMPORTANT: Pass the campaign's client_id for accurate share calculation
      );

      // Get campaign-specific metrics
      const campaignMetrics = metrics._byCampaign || {};
      const campaignMetricsData =
        campaignMetrics[campaign.id] || metrics[campaign.program_id];

      if (!campaignMetricsData) {
        console.warn(`⚠️  No metrics found for campaign ${campaign.id}`);
        continue;
      }

      console.log(
        `   Hours played: ${campaignMetricsData.hours_played_since_campaign_start} / ${campaign.hours_bought} (${campaignMetricsData.campaign_completion_percent}%)`,
      );
      console.log(
        `   Share of Voice: ${
          campaignMetricsData.share_of_voice_percent || 100
        }%`,
      );

      if (campaignMetricsData.campaign_completion_percent >= 100) {
        completedCampaigns.push({
          ...campaign,
          completion_percent: campaignMetricsData.campaign_completion_percent,
          hours_played: campaignMetricsData.hours_played_since_campaign_start,
          share_of_voice: campaignMetricsData.share_of_voice_percent,
        });

        console.log(
          `🎯 Campaign ${campaign.id} is COMPLETE: ${campaignMetricsData.campaign_completion_percent}%`,
        );
      } else {
        console.log(
          `   Campaign ${campaign.id} is NOT complete yet (${campaignMetricsData.campaign_completion_percent}%)`,
        );
      }
    }

    console.log(
      `\n✅ Found ${completedCampaigns.length} campaigns ready for completion`,
    );
    return completedCampaigns;
  } catch (error) {
    console.error("Error checking for completed campaigns:", error.message);
    return [];
  }
}

/**
 * Complete a campaign:
 * 1. Update campaign status to 'completed'
 * 2. Apply pre-computed playlist transition (removes files from ColorLight + local DB)
 * 3. Snapshot is created by applyTransitionForCampaign
 *
 * @param {number} campaignId - Campaign ID to complete
 * @returns {Promise<Object>} Results summary
 */
async function completeCampaign(campaignId) {
  const results = {
    success: true,
    campaign_id: campaignId,
    campaign_updated: false,
    files_removed: 0,
    snapshot_created: false,
    errors: [],
  };

  try {
    console.log(
      `🏁 Starting campaign completion for campaign ${campaignId}...`,
    );

    // Step 1: Get campaign details
    const { data: campaign, error: fetchError } = await supabase
      .from("campaign")
      .select("id, client_id, program_id, status")
      .eq("id", campaignId)
      .single();

    if (fetchError || !campaign) {
      throw new Error(
        `Campaign ${campaignId} not found: ${fetchError?.message}`,
      );
    }

    if (campaign.status === "completed") {
      console.log(`ℹ️  Campaign ${campaignId} is already completed - skipping`);
      results.campaign_updated = true;
      return results;
    }

    // Step 2: Update campaign status to 'completed' and set completed_at timestamp
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("campaign")
      .update({
        status: "completed",
        completed_at: now,
      })
      .eq("id", campaignId);

    if (updateError) {
      throw new Error(
        `Failed to update campaign status: ${updateError.message}`,
      );
    }

    results.campaign_updated = true;
    console.log(
      `✅ Campaign ${campaignId} status updated to 'completed' at ${now}`,
    );

    // Step 3: Apply pre-computed playlist transition
    // This handles: push new playlist state to ColorLight, mark files removed, create snapshot, recompute schedule
    const transitionResult = await applyTransitionForCampaign(campaignId);

    results.files_removed = transitionResult.files_removed || 0;
    results.snapshot_created = transitionResult.snapshot_created || false;

    if (transitionResult.errors && transitionResult.errors.length > 0) {
      results.errors.push(...transitionResult.errors);
    }

    console.log(
      `🎉 Campaign ${campaignId} completion workflow finished successfully!`,
    );
  } catch (error) {
    console.error(`❌ Error completing campaign ${campaignId}:`, error.message);
    results.success = false;
    results.errors.push(error.message);
  }

  return results;
}

/**
 * Monitor and auto-complete campaigns that have reached 100%
 * This function checks all active campaigns and completes any that are at 100%+
 *
 * @returns {Promise<Object>} Results summary
 */
async function monitorAndAutoComplete() {
  const results = {
    success: true,
    checked_at: new Date().toISOString(),
    campaigns_checked: 0,
    campaigns_completed: 0,
    completion_results: [],
    errors: [],
  };

  try {
    console.log("🔍 Checking for campaigns at 100% completion...");

    const completedCampaigns = await checkForCompletedCampaigns();
    results.campaigns_checked = completedCampaigns.length;

    if (completedCampaigns.length === 0) {
      console.log("ℹ️  No campaigns ready for completion");
      return results;
    }

    console.log(
      `🎯 Found ${completedCampaigns.length} campaigns ready for completion`,
    );

    // Complete each campaign
    for (const campaign of completedCampaigns) {
      console.log(
        `\n🏁 Completing campaign ${campaign.id} (${campaign.completion_percent}% complete)...`,
      );

      const completionResult = await completeCampaign(campaign.id);
      results.completion_results.push(completionResult);

      if (completionResult.success) {
        results.campaigns_completed++;
        console.log(`✅ Campaign ${campaign.id} completed successfully`);
      } else {
        console.error(
          `❌ Failed to complete campaign ${campaign.id}:`,
          completionResult.errors,
        );
        results.errors.push(
          `Campaign ${campaign.id}: ${completionResult.errors.join(", ")}`,
        );
      }
    }

    console.log(
      `\n🎉 Auto-completion complete: ${results.campaigns_completed}/${completedCampaigns.length} campaigns processed`,
    );
  } catch (error) {
    console.error("❌ Error in campaign monitor:", error.message);
    results.success = false;
    results.errors.push(error.message);
  }

  return results;
}

module.exports = {
  checkForCompletedCampaigns,
  completeCampaign,
  monitorAndAutoComplete,
};
