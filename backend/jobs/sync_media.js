const { syncMediaFromColorLight } = require("../services/mediaSync");
const { withLock } = require("../utils/distributedLock");

/**
 * Media Sync Job
 * 
 * Fetches media metadata from ColorLight's /wp-json/wp/v2/media endpoint
 * and enriches files table with client_id (from custom tags), source_url, title, etc.
 * 
 * Runs: Daily at 2:00 AM via cron
 * Lock: Prevents duplicate execution across multiple instances
 */

async function runMediaSync() {
  try {
    console.log("\n🌙 ===== MEDIA SYNC JOB STARTED =====");
    console.log(`⏰ Time: ${new Date().toISOString()}`);

    const result = await syncMediaFromColorLight();

    if (result.success) {
      console.log(`✅ Media sync completed successfully`);
      console.log(`📊 Summary:`);
      console.log(`   - Fetched: ${result.total_fetched} media items`);
      console.log(`   - Processed: ${result.total_processed} files`);
      console.log(`   - With client_id: ${result.files_with_client_id}`);
      console.log(`   - Without client_id: ${result.files_without_client_id}`);
      console.log(`   - Duration: ${(result.duration_ms / 1000).toFixed(2)}s`);

      return {
        success: true,
        ...result,
      };
    } else {
      console.error(`❌ Media sync failed`);
      console.error(`Errors:`, result.errors);

      return {
        success: false,
        error: result.errors.join(", "),
        ...result,
      };
    }
  } catch (error) {
    console.error("❌ Fatal error in media sync:", error.message);
    console.error("Stack:", error.stack);

    return {
      success: false,
      error: error.message,
    };
  }
}

// Run if called directly (via cron)
if (require.main === module) {
  // Use distributed locking to prevent duplicate execution across multiple machines
  withLock("sync_media", async () => {
    return await runMediaSync();
  })
    .then((result) => {
      if (result === null) {
        // Lock was already held, job skipped
        console.log("⏭️  Job skipped - another instance is already running");
        process.exit(0);
      } else if (result && result.success) {
        console.log("✅ Media sync job completed successfully");
        process.exit(0);
      } else {
        console.error(
          "❌ Media sync job failed:",
          result?.error || "Unknown error"
        );
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("❌ Unhandled error:", error.message);
      process.exit(1);
    });
}

module.exports = { runMediaSync };

