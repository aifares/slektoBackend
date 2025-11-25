const { supabase } = require("../config/supabase");

/**
 * Create a share of voice snapshot for a specific date
 * This can be called by the daily cron OR when a campaign completes
 *
 * @param {Date} snapshotDate - The date to snapshot (defaults to yesterday)
 * @returns {Promise<Object>} Results summary
 */
async function createShareOfVoiceSnapshot(snapshotDate = null) {
  const results = {
    success: true,
    snapshot_date: null,
    programs_processed: 0,
    snapshots_created: 0,
    errors: [],
  };

  try {
    // Default to yesterday if not provided (for nightly cron)
    const targetDate =
      snapshotDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateString = targetDate.toISOString().split("T")[0];
    results.snapshot_date = dateString;

    console.log(`📸 Creating Share of Voice snapshot for ${dateString}...`);

    // Step 1: Find all programs with active campaigns
    const { data: activeCampaigns, error: campaignsError } = await supabase
      .from("campaign")
      .select("program_id, client_id")
      .eq("status", "active");

    if (campaignsError) {
      throw new Error(
        `Failed to fetch active campaigns: ${campaignsError.message}`
      );
    }

    if (!activeCampaigns || activeCampaigns.length === 0) {
      console.log("ℹ️  No active campaigns found - skipping snapshot");
      return results;
    }

    // Get unique program IDs
    const programIds = [...new Set(activeCampaigns.map((c) => c.program_id))];
    console.log(
      `📋 Processing ${programIds.length} programs with active campaigns`
    );

    // Step 2: For each program, count files per client
    for (const programId of programIds) {
      try {
        // Get all files for this program that are NOT removed
        const { data: files, error: filesError } = await supabase
          .from("files")
          .select("id, client_id")
          .eq("program_id", programId)
          .is("removed_at", null); // Only count active files

        if (filesError) {
          console.warn(
            `⚠️  Error fetching files for program ${programId}:`,
            filesError.message
          );
          results.errors.push(`Program ${programId}: ${filesError.message}`);
          continue;
        }

        if (!files || files.length === 0) {
          console.log(`ℹ️  Program ${programId}: No active files - skipping`);
          continue;
        }

        const totalFiles = files.length;

        // Count files per client
        const clientCounts = {};
        files.forEach((f) => {
          if (f.client_id) {
            clientCounts[f.client_id] = (clientCounts[f.client_id] || 0) + 1;
          }
        });

        // Create snapshot for each client
        for (const [clientId, fileCount] of Object.entries(clientCounts)) {
          const sharePercent = (fileCount / totalFiles) * 100;

          // Upsert snapshot (replace if already exists for this date)
          const { error: upsertError } = await supabase
            .from("share_of_voice_snapshots")
            .upsert(
              {
                program_id: programId,
                client_id: parseInt(clientId),
                file_count: fileCount,
                total_files_in_program: totalFiles,
                share_percent: sharePercent,
                snapshot_date: dateString,
              },
              {
                onConflict: "program_id,client_id,snapshot_date",
              }
            );

          if (upsertError) {
            console.warn(
              `⚠️  Error creating snapshot for program ${programId}, client ${clientId}:`,
              upsertError.message
            );
            results.errors.push(
              `Program ${programId}, Client ${clientId}: ${upsertError.message}`
            );
          } else {
            results.snapshots_created++;
            console.log(
              `✅ Snapshot: Program ${programId}, Client ${clientId}: ${fileCount}/${totalFiles} (${sharePercent.toFixed(
                1
              )}%)`
            );
          }
        }

        results.programs_processed++;
      } catch (error) {
        console.error(
          `❌ Error processing program ${programId}:`,
          error.message
        );
        results.errors.push(`Program ${programId}: ${error.message}`);
      }
    }

    console.log(
      `✅ Snapshot complete: ${results.snapshots_created} snapshots created for ${results.programs_processed} programs`
    );
  } catch (error) {
    console.error("❌ Fatal error creating snapshot:", error.message);
    results.success = false;
    results.errors.push(error.message);
  }

  return results;
}

/**
 * Get time-weighted share of voice for a client in a program over a date range
 * Uses daily snapshots to calculate accurate historical share
 *
 * @param {number} programId - Program ID
 * @param {number} clientId - Client ID
 * @param {string} startDate - Start date (ISO string)
 * @param {string} endDate - End date (ISO string)
 * @returns {Promise<number>} Average share percentage (0-100)
 */
async function getTimeWeightedShare(programId, clientId, startDate, endDate) {
  try {
    const startDateOnly = startDate.split("T")[0];
    const endDateOnly = endDate.split("T")[0];

    const { data: snapshots, error } = await supabase
      .from("share_of_voice_snapshots")
      .select("snapshot_date, share_percent")
      .eq("program_id", programId)
      .eq("client_id", clientId)
      .gte("snapshot_date", startDateOnly)
      .lte("snapshot_date", endDateOnly)
      .order("snapshot_date");

    if (error) {
      console.warn(
        `⚠️  Error fetching snapshots for program ${programId}, client ${clientId}:`,
        error.message
      );
      return null; // Signal to fall back to current method
    }

    if (!snapshots || snapshots.length === 0) {
      console.log(
        `ℹ️  No snapshots found for program ${programId}, client ${clientId} - using current file count`
      );
      return null; // Signal to fall back to current method
    }

    // Simple average for now (can be enhanced to weight by actual playtime per day)
    const avgShare =
      snapshots.reduce((sum, s) => sum + s.share_percent, 0) / snapshots.length;

    console.log(
      `📊 Time-weighted share for program ${programId}, client ${clientId}: ${avgShare.toFixed(
        1
      )}% (from ${snapshots.length} snapshots)`
    );

    return avgShare;
  } catch (error) {
    console.error(
      `❌ Error calculating time-weighted share for program ${programId}, client ${clientId}:`,
      error.message
    );
    return null; // Signal to fall back to current method
  }
}

/**
 * Fallback: Get current share from files table (real-time)
 * Used when snapshots are not available or as a backup
 *
 * @param {number} programId - Program ID
 * @param {number} clientId - Client ID
 * @returns {Promise<number>} Share percentage (0-100)
 */
async function getCurrentShare(programId, clientId) {
  try {
    const { data: files, error } = await supabase
      .from("files")
      .select("id, client_id")
      .eq("program_id", programId)
      .is("removed_at", null); // Only count active files

    if (error || !files || files.length === 0) {
      return 0;
    }

    const totalFiles = files.length;
    const clientFiles = files.filter((f) => f.client_id === clientId).length;

    return (clientFiles / totalFiles) * 100;
  } catch (error) {
    console.error("Error getting current share:", error.message);
    return 0;
  }
}

module.exports = {
  createShareOfVoiceSnapshot,
  getTimeWeightedShare,
  getCurrentShare,
};
