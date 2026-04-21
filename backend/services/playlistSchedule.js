const { supabase } = require("../config/supabase");
const {
  fetchProgram,
  updateProgram,
  buildPayloadFromExistingPages,
} = require("./colorLight");
const { createSnapshotForProgram } = require("./shareOfVoiceSnapshots");

const TOTAL_BAGS = 25;

/**
 * Check bag availability for a date range
 * Returns the number of available bags on the most constrained day
 *
 * @param {string} startAt - ISO date string
 * @param {string} endAt - ISO date string
 * @param {number|null} excludeCampaignId - Campaign ID to exclude (for updates)
 * @returns {Promise<{available: number, peakUsed: number, conflictDate: string|null}>}
 */
async function checkBagAvailability(startAt, endAt, excludeCampaignId = null) {
  // Get all overlapping active/planned campaigns with their per-playlist bag assignments
  const { data: campaigns, error } = await supabase
    .from("campaign")
    .select(
      "id, start_at, end_at, campaign_playlists(bags_assigned)"
    )
    .in("status", ["active", "planned"])
    .lte("start_at", endAt)
    .gte("end_at", startAt);

  if (error) {
    throw new Error(`Failed to check bag availability: ${error.message}`);
  }

  // Filter out the excluded campaign (for updates) and sum bags across playlists
  const relevantCampaigns = (campaigns || [])
    .filter((c) => c.id !== excludeCampaignId)
    .map((c) => ({
      start_at: c.start_at,
      end_at: c.end_at,
      bags_total: (c.campaign_playlists || []).reduce(
        (sum, p) => sum + (p.bags_assigned || 0),
        0
      ),
    }));

  if (relevantCampaigns.length === 0) {
    return { available: TOTAL_BAGS, peakUsed: 0, conflictDate: null };
  }

  // Calculate peak usage across all days in the range
  const start = new Date(startAt);
  const end = new Date(endAt);
  let peakUsed = 0;
  let conflictDate = null;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayStr = d.toISOString().split("T")[0];
    let dailyBags = 0;

    for (const c of relevantCampaigns) {
      const cStart = new Date(c.start_at).toISOString().split("T")[0];
      const cEnd = new Date(c.end_at).toISOString().split("T")[0];

      if (dayStr >= cStart && dayStr <= cEnd) {
        dailyBags += c.bags_total;
      }
    }

    if (dailyBags > peakUsed) {
      peakUsed = dailyBags;
      conflictDate = dayStr;
    }
  }

  return {
    available: TOTAL_BAGS - peakUsed,
    peakUsed,
    conflictDate: peakUsed >= TOTAL_BAGS ? conflictDate : null,
  };
}

/**
 * Compute and store playlist transitions for a program
 * Called whenever a campaign is created, cancelled, or modified on this program
 *
 * For each active/planned campaign on the program, pre-builds the playlist state
 * that should be applied when that campaign completes (i.e. its files removed).
 *
 * @param {number} programId - Program ID to compute schedule for
 * @returns {Promise<{transitions_created: number}>}
 */
async function computeScheduleForProgram(programId) {
  console.log(
    `📅 Computing playlist schedule for program ${programId}...`
  );

  // Get all active/planned campaigns on this program
  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaign")
    .select("id, client_id, program_id, hours_bought, start_at, end_at, status")
    .eq("program_id", programId)
    .in("status", ["active", "planned"]);

  if (campaignsError) {
    throw new Error(
      `Failed to fetch campaigns for program: ${campaignsError.message}`
    );
  }

  if (!campaigns || campaigns.length === 0) {
    console.log(`   No active campaigns on program ${programId}`);
    return { transitions_created: 0 };
  }

  // Delete existing unapplied transitions for this program (recompute from scratch)
  const { error: deleteError } = await supabase
    .from("playlist_schedule")
    .delete()
    .eq("program_id", programId)
    .eq("applied", false);

  if (deleteError) {
    console.warn(
      `⚠️  Failed to clear old transitions: ${deleteError.message}`
    );
  }

  // Get all client files for this program (active only)
  const { data: allFiles, error: filesError } = await supabase
    .from("files")
    .select("id, media_id, client_id, name")
    .eq("program_id", programId)
    .is("removed_at", null);

  if (filesError) {
    throw new Error(`Failed to fetch files: ${filesError.message}`);
  }

  // Get the current program state from ColorLight
  let programData;
  try {
    programData = await fetchProgram(programId);
  } catch (err) {
    console.error(
      `❌ Failed to fetch program ${programId} from ColorLight: ${err.message}`
    );
    throw err;
  }

  // Map media_id -> client_id for quick lookup
  const mediaToClient = {};
  for (const file of allFiles || []) {
    if (file.media_id) {
      mediaToClient[file.media_id] = file.client_id;
    }
  }

  // All unique client IDs in this program
  const allClientIds = [
    ...new Set((allFiles || []).map((f) => f.client_id).filter(Boolean)),
  ];

  // For each campaign, build the transition: "what the playlist looks like after this campaign's files are removed"
  let transitionsCreated = 0;

  for (const campaign of campaigns) {
    const clientId = campaign.client_id;

    // Client IDs that remain after this campaign completes
    const remainingClientIds = allClientIds.filter((id) => id !== clientId);

    // Filter program pages: keep pages that do NOT contain this client's files
    const clientMediaIds = (allFiles || [])
      .filter((f) => f.client_id === clientId)
      .map((f) => f.media_id)
      .filter(Boolean);

    const remainingPages = (programData.children || []).filter((page) => {
      const fileWindow = page.children?.find((c) => c.type === "fileWindow");
      const filesInPage = fileWindow?.children || [];
      const hasClientFile = filesInPage.some((file) =>
        clientMediaIds.includes(file.fileID)
      );
      return !hasClientFile;
    });

    // Build the payload that would be PUT to ColorLight after removal
    const playlistState = buildPayloadFromExistingPages(
      programData,
      remainingPages
    );

    // Store the transition
    const { error: insertError } = await supabase
      .from("playlist_schedule")
      .insert({
        program_id: programId,
        campaign_id: campaign.id,
        transition_type: "campaign_complete",
        playlist_state: playlistState,
        remaining_client_ids: remainingClientIds,
        applied: false,
      });

    if (insertError) {
      console.error(
        `❌ Failed to insert transition for campaign ${campaign.id}: ${insertError.message}`
      );
    } else {
      transitionsCreated++;
      console.log(
        `   ✅ Transition for campaign ${campaign.id} (client ${clientId}): ${remainingPages.length} pages remain`
      );
    }
  }

  console.log(
    `📅 Schedule computed: ${transitionsCreated} transitions for program ${programId}`
  );
  return { transitions_created: transitionsCreated };
}

/**
 * Apply a scheduled transition for a (campaign, program) pair.
 *
 * Pushes the pre-built playlist state to ColorLight, marks that playlist's
 * files as removed locally, and records the transition as applied.
 *
 * For rotation campaigns the caller passes campaign.program_id.
 * For split campaigns the caller iterates over each campaign_playlists row
 * and calls this once per program.
 *
 * @param {number} campaignId
 * @param {number} [programId] - optional; falls back to campaign.program_id
 *   (the rollup). Required callers for split-mode playlists.
 * @returns {Promise<Object>} Result summary
 */
async function applyTransitionForCampaign(campaignId, programId = null) {
  const result = {
    success: true,
    campaign_id: campaignId,
    program_id: programId,
    transition_applied: false,
    files_removed: 0,
    snapshot_created: false,
    errors: [],
  };

  try {
    // Get campaign details (for client_id + rollup program_id fallback)
    const { data: campaign, error: campaignError } = await supabase
      .from("campaign")
      .select("id, client_id, program_id")
      .eq("id", campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    const effectiveProgramId = programId || campaign.program_id;
    result.program_id = effectiveProgramId;

    // Find the transition for this (campaign, program) pair
    const { data: transition, error: fetchError } = await supabase
      .from("playlist_schedule")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("program_id", effectiveProgramId)
      .eq("applied", false)
      .maybeSingle();

    if (fetchError || !transition) {
      console.warn(
        `⚠️  No pending transition for campaign ${campaignId} / program ${effectiveProgramId} - may need recompute`
      );
      result.errors.push("No pending transition found");
      return result;
    }

    // Step 1: Push the pre-built playlist state to ColorLight
    console.log(
      `🚀 Applying transition for campaign ${campaignId} on program ${effectiveProgramId}...`
    );
    await updateProgram(effectiveProgramId, transition.playlist_state);
    result.transition_applied = true;

    // Step 2: Mark this playlist's files as removed in local DB
    //         (scoped to program + client, so split-mode playlists stay isolated)
    const now = new Date().toISOString();
    const { data: removedFiles, error: removeError } = await supabase
      .from("files")
      .update({ removed_at: now })
      .eq("program_id", effectiveProgramId)
      .eq("client_id", campaign.client_id)
      .is("removed_at", null)
      .select("id, name");

    if (removeError) {
      result.errors.push(`Failed to mark files as removed: ${removeError.message}`);
    } else {
      result.files_removed = removedFiles ? removedFiles.length : 0;
      console.log(`✅ Marked ${result.files_removed} files as removed`);
    }

    // Step 3: Mark transition as applied
    const { error: updateError } = await supabase
      .from("playlist_schedule")
      .update({ applied: true, applied_at: now })
      .eq("id", transition.id);

    if (updateError) {
      result.errors.push(`Failed to mark transition applied: ${updateError.message}`);
    }

    // Step 4: Create SOV snapshot to capture new share distribution
    try {
      const snapshotResult = await createSnapshotForProgram(
        effectiveProgramId
      );
      if (snapshotResult && snapshotResult.success) {
        result.snapshot_created = true;
      }
    } catch (err) {
      result.errors.push(`Snapshot creation failed: ${err.message}`);
    }

    // Step 5: Recompute schedule for remaining campaigns on this program
    await computeScheduleForProgram(effectiveProgramId);

    console.log(
      `🎉 Transition applied for campaign ${campaignId} / program ${effectiveProgramId}`
    );
  } catch (error) {
    console.error(
      `❌ Error applying transition for campaign ${campaignId}: ${error.message}`
    );
    result.success = false;
    result.errors.push(error.message);
  }

  return result;
}

module.exports = {
  TOTAL_BAGS,
  checkBagAvailability,
  computeScheduleForProgram,
  applyTransitionForCampaign,
};
