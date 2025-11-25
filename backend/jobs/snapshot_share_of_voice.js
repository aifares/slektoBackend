const {
  createShareOfVoiceSnapshot,
} = require("../services/shareOfVoiceSnapshots");
const { withLock } = require("../utils/distributedLock");

/**
 * Daily Share of Voice Snapshot Job
 * Runs at 2 AM every night to capture daily file distribution for each program
 * Creates historical record for accurate Share of Voice calculation
 */

if (require.main === module) {
  withLock("snapshot_share_of_voice", async () => {
    console.log("📸 Starting daily Share of Voice snapshot job...");
    console.log("⏰ Started at:", new Date().toISOString());

    // Create snapshot for yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await createShareOfVoiceSnapshot(yesterday);

    if (result && result.success) {
      console.log("✅ Share of Voice snapshot completed successfully");
      console.log(`   Date: ${result.snapshot_date}`);
      console.log(`   Programs: ${result.programs_processed}`);
      console.log(`   Snapshots: ${result.snapshots_created}`);

      if (result.errors.length > 0) {
        console.warn(
          `⚠️  Completed with ${result.errors.length} errors:`,
          result.errors
        );
      }

      return result;
    } else {
      console.error("❌ Share of Voice snapshot failed");
      throw new Error(result?.errors?.join(", ") || "Unknown error");
    }
  })
    .then((result) => {
      if (result === null) {
        console.log(
          "⏭️  Share of Voice snapshot skipped - another instance is already running"
        );
        process.exit(0);
      } else if (result && result.success) {
        console.log("✅ Share of Voice snapshot job completed successfully");
        process.exit(0);
      } else {
        console.error(
          "❌ Share of Voice snapshot job failed:",
          result?.message || "Unknown error"
        );
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("❌ Unhandled error in snapshot job:", error.message);
      process.exit(1);
    });
}

module.exports = { createShareOfVoiceSnapshot };
