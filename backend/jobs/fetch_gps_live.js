const axios = require("axios");
const { COLORLIGHT_LIVE_URL, TRACK_AUTH_HEADER } = require("../utils");
const { storeGpsDataFromLive } = require("../services/gps");

async function fetchLiveGpsData() {
  try {
    console.log("🛰️ Fetching live GPS data for all terminals...");

    // Call the /live endpoint to get current GPS data for all terminals
    const response = await axios.post(
      COLORLIGHT_LIVE_URL,
      {
        terminalGroupId: 6640, // Hardcoded group ID from existing code
      },
      TRACK_AUTH_HEADER
    );

    const liveData = response.data;

    if (!liveData || liveData.length === 0) {
      console.log("ℹ️  No terminals found in live GPS data");
      return { success: true, terminalsProcessed: 0, pointsStored: 0 };
    }

    console.log(`📡 Found ${liveData.length} terminals with live GPS data`);

    let totalPointsStored = 0;
    let terminalsProcessed = 0;
    let errors = 0;

    // Process each terminal's GPS data
    for (const terminalData of liveData) {
      try {
        const terminalId = terminalData.terminalId;

        if (!terminalData.latitude || !terminalData.longitude) {
          console.log(`⚠️  Terminal ${terminalId}: No valid GPS data`);
          continue;
        }

        // Check online status using led_latest_time from database
        const { isTerminalOnline } = require("../services/gps");
        const isOnline = await isTerminalOnline(terminalId);

        if (!isOnline) {
          console.log(
            `🔴 Terminal ${terminalId}: Offline (led_latest_time > 3 minutes ago)`
          );
          continue;
        }

        console.log(`🟢 Terminal ${terminalId}: Online - processing GPS data`);

        // Store GPS data for this terminal
        const pointsStored = await storeGpsDataFromLive(
          terminalId,
          terminalData
        );

        if (pointsStored > 0) {
          console.log(
            `✅ Terminal ${terminalId}: Stored ${pointsStored} GPS point(s)`
          );
          totalPointsStored += pointsStored;
        } else {
          console.log(`ℹ️  Terminal ${terminalId}: No new GPS points to store`);
        }

        terminalsProcessed++;
      } catch (terminalError) {
        errors++;
        console.error(
          `❌ Terminal ${terminalData.terminalId}: Failed to store GPS data -`,
          terminalError.message
        );
      }
    }

    console.log(
      `🏁 Live GPS polling completed. Terminals: ${terminalsProcessed}, Points: ${totalPointsStored}, Errors: ${errors}`
    );

    return {
      success: errors === 0,
      terminalsProcessed,
      pointsStored: totalPointsStored,
      errors,
    };
  } catch (error) {
    console.error("❌ Fatal error in live GPS polling:", error.message);
    return {
      success: false,
      error: error.message,
      terminalsProcessed: 0,
      pointsStored: 0,
    };
  }
}

// Run if called directly
if (require.main === module) {
  fetchLiveGpsData()
    .then((result) => {
      if (result.success) {
        console.log("✅ Live GPS polling completed successfully");
        process.exit(0);
      } else {
        console.error("❌ Live GPS polling failed:", result.error);
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("❌ Unhandled error:", error.message);
      process.exit(1);
    });
}

module.exports = { fetchLiveGpsData };
