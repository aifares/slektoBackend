const { supabase } = require("../config/supabase");
const { createShareOfVoiceSnapshot } = require("./shareOfVoiceSnapshots");

/**
 * Check for campaigns that have reached 100% completion
 * @returns {Promise<Array>} List of completed campaigns
 */
async function checkForCompletedCampaigns() {
  try {
    // Get all active campaigns
    const { data: campaigns, error } = await supabase
      .from("campaign")
      .select(
        "id, client_id, program_id, start_at, end_at, hours_bought, status"
      )
      .eq("status", "active");

    if (error) {
      console.error("Error fetching campaigns:", error.message);
      return [];
    }

    if (!campaigns || campaigns.length === 0) {
      return [];
    }

    // Calculate completion for each and find those at 100%+
    const { buildCampaignPlaybackMetrics } = require("./campaignMetrics");

    const campaignsWithStatus = campaigns.map((c) => {
      const now = new Date();
      return {
        ...c,
        isActive: new Date(c.start_at) <= now && new Date(c.end_at) >= now,
      };
    });

    const programIds = [...new Set(campaigns.map((c) => c.program_id))];

    // Get all terminal IDs for these programs
    const { data: sessions } = await supabase
      .from("playing")
      .select("terminal_id")
      .in("program_id", programIds);

    const terminalIds = sessions
      ? [...new Set(sessions.map((s) => s.terminal_id))]
      : null;

    // Calculate metrics for all campaigns
    const metrics = await buildCampaignPlaybackMetrics(
      campaignsWithStatus,
      programIds,
      terminalIds,
      null // No client filter - need metrics for all campaigns
    );

    // Find campaigns at 100%+
    const completedCampaigns = [];

    // Use campaign-level metrics if available (for accurate per-campaign calculations)
    const campaignMetrics = metrics._byCampaign || {};

    for (const campaign of campaigns) {
      // Try campaign-level metrics first (more accurate for multiple campaigns per program)
      let campaignMetricsData = campaignMetrics[campaign.id];

      // Fallback to program-level metrics for backward compatibility
      if (!campaignMetricsData) {
        campaignMetricsData = metrics[campaign.program_id];
      }

      if (
        campaignMetricsData &&
        campaignMetricsData.campaign_completion_percent >= 100
      ) {
        completedCampaigns.push({
          ...campaign,
          completion_percent: campaignMetricsData.campaign_completion_percent,
          hours_played: campaignMetricsData.hours_played_since_campaign_start,
        });

        console.log(
          `🎯 Campaign ${campaign.id} (Client ${campaign.client_id}, Program ${campaign.program_id}) is complete: ${campaignMetricsData.campaign_completion_percent}% (hours_bought: ${campaign.hours_bought}, hours_played: ${campaignMetricsData.hours_played_since_campaign_start})`
        );
      }
    }

    return completedCampaigns;
  } catch (error) {
    console.error("Error checking for completed campaigns:", error.message);
    return [];
  }
}

/**
 * Complete a campaign:
 * 1. Update campaign status to 'completed'
 * 2. Mark client's files as removed (set removed_at timestamp)
 * 3. Create immediate snapshot to capture state change
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
      `🏁 Starting campaign completion for campaign ${campaignId}...`
    );

    // Step 1: Get campaign details
    const { data: campaign, error: fetchError } = await supabase
      .from("campaign")
      .select("id, client_id, program_id, status")
      .eq("id", campaignId)
      .single();

    if (fetchError || !campaign) {
      throw new Error(
        `Campaign ${campaignId} not found: ${fetchError?.message}`
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
        `Failed to update campaign status: ${updateError.message}`
      );
    }

    results.campaign_updated = true;
    console.log(
      `✅ Campaign ${campaignId} status updated to 'completed' at ${now}`
    );

    // Step 3: Mark client's files as removed from the program
    const { data: removedFiles, error: removeError } = await supabase
      .from("files")
      .update({ removed_at: now })
      .eq("program_id", campaign.program_id)
      .eq("client_id", campaign.client_id)
      .is("removed_at", null) // Only update files that aren't already removed
      .select("id, name");

    if (removeError) {
      throw new Error(`Failed to remove files: ${removeError.message}`);
    }

    results.files_removed = removedFiles ? removedFiles.length : 0;
    console.log(
      `✅ Marked ${results.files_removed} files as removed from program ${campaign.program_id}`
    );

    if (removedFiles && removedFiles.length > 0) {
      removedFiles.forEach((f) => {
        console.log(`   - ${f.name}`);
      });
    }

    // Step 4: Create immediate snapshot to capture the state change
    console.log("📸 Creating immediate snapshot to capture completion...");
    const today = new Date();
    const snapshotResult = await createShareOfVoiceSnapshot(today);

    if (snapshotResult && snapshotResult.success) {
      results.snapshot_created = true;
      console.log(
        `✅ Immediate snapshot created: ${snapshotResult.snapshots_created} snapshots`
      );
    } else {
      console.warn("⚠️  Snapshot creation had issues:", snapshotResult?.errors);
      results.errors.push("Snapshot creation incomplete");
    }

    console.log(
      `🎉 Campaign ${campaignId} completion workflow finished successfully!`
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
      `🎯 Found ${completedCampaigns.length} campaigns ready for completion`
    );

    // Complete each campaign
    for (const campaign of completedCampaigns) {
      console.log(
        `\n🏁 Completing campaign ${campaign.id} (${campaign.completion_percent}% complete)...`
      );

      const completionResult = await completeCampaign(campaign.id);
      results.completion_results.push(completionResult);

      if (completionResult.success) {
        results.campaigns_completed++;
        console.log(`✅ Campaign ${campaign.id} completed successfully`);
      } else {
        console.error(
          `❌ Failed to complete campaign ${campaign.id}:`,
          completionResult.errors
        );
        results.errors.push(
          `Campaign ${campaign.id}: ${completionResult.errors.join(", ")}`
        );
      }
    }

    console.log(
      `\n🎉 Auto-completion complete: ${results.campaigns_completed}/${completedCampaigns.length} campaigns processed`
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
