/**
 * Cron Job: Apply Playlist Transitions
 *
 * Runs every few minutes to check for completed campaigns
 * and apply their pre-computed playlist transitions.
 *
 * This replaces the old reactive polling approach with a
 * schedule-driven system where transitions are pre-built
 * at campaign creation time.
 */

const { monitorAndAutoComplete } = require("../services/campaignCompletion");

async function run() {
  const startTime = Date.now();
  console.log(`\n🔄 ===== PLAYLIST TRANSITION CHECK =====`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);

  try {
    const result = await monitorAndAutoComplete();

    const duration = Date.now() - startTime;
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(
      `📊 Checked: ${result.campaigns_checked}, Completed: ${result.campaigns_completed}`
    );

    if (result.errors && result.errors.length > 0) {
      console.warn(`⚠️  Errors:`, result.errors);
    }

    console.log(`✅ ===== TRANSITION CHECK COMPLETE =====\n`);
  } catch (error) {
    console.error(`❌ Transition check failed:`, error.message);
    console.error(error.stack);
  }
}

// Run if called directly
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { run };
