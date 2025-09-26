const { supabase } = require("../config/supabase");

async function insertTerminalGpsPoints(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("terminal_gps_data")
    .insert(rows)
    .select();

  if (error) {
    throw new Error(`Failed to insert terminal_gps_data: ${error.message}`);
  }
  return data || [];
}

// Helper function to parse GPS data from track API response
function parseGpsDataFromTrack(terminalId, trackResponse) {
  if (!trackResponse?.data || !Array.isArray(trackResponse.data)) {
    return [];
  }

  return trackResponse.data.map((point) => {
    // Use serverTime as the recorded timestamp (UTC)
    const recordedAt = new Date(point.serverTime);
    const dataDate = recordedAt.toISOString().split("T")[0]; // YYYY-MM-DD format

    return {
      terminal_id: terminalId.toString(),
      data_date: dataDate,
      longitude: Number(point.longitude),
      latitude: Number(point.latitude),
      recorded_at: recordedAt.toISOString(),
    };
  });
}

// Function to store GPS data from track API response
async function storeGpsDataFromTrack(terminalId, trackResponse) {
  const gpsPoints = parseGpsDataFromTrack(terminalId, trackResponse);

  if (gpsPoints.length === 0) {
    return [];
  }

  return await insertTerminalGpsPoints(gpsPoints);
}

// Helper function to check if terminal is online based on led_latest_time from database
// Uses 3-minute threshold as requested
async function isTerminalOnline(terminalId, thresholdSeconds = 180) {
  // 3 minutes = 180 seconds
  const { supabase } = require("../config/supabase");

  try {
    // Get terminal's led_latest_time from database
    const { data: terminal, error } = await supabase
      .from("terminals")
      .select("led_latest_time")
      .eq("terminalid", terminalId)
      .single();

    if (error || !terminal?.led_latest_time) {
      return false;
    }

    const currentTime = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
    const secondsSinceLastReport = currentTime - terminal.led_latest_time;

    return secondsSinceLastReport <= thresholdSeconds;
  } catch (error) {
    console.error(
      `Error checking online status for terminal ${terminalId}:`,
      error.message
    );
    return false;
  }
}

// Helper function to parse GPS data from live API response
function parseGpsDataFromLive(terminalId, liveData) {
  if (!liveData?.latitude || !liveData?.longitude) {
    return [];
  }

  // Use serverTime as the recorded timestamp if available, otherwise use current time
  const recordedAt = liveData.serverTime
    ? new Date(liveData.serverTime)
    : new Date();
  const dataDate = recordedAt.toISOString().split("T")[0]; // YYYY-MM-DD format

  return [
    {
      terminal_id: terminalId.toString(),
      data_date: dataDate,
      longitude: Number(liveData.longitude),
      latitude: Number(liveData.latitude),
      recorded_at: recordedAt.toISOString(),
    },
  ];
}

// Function to store GPS data from live API response
async function storeGpsDataFromLive(terminalId, liveData) {
  const gpsPoints = parseGpsDataFromLive(terminalId, liveData);

  if (gpsPoints.length === 0) {
    return 0;
  }

  const storedPoints = await insertTerminalGpsPoints(gpsPoints);
  return storedPoints.length;
}

module.exports = {
  insertTerminalGpsPoints,
  parseGpsDataFromTrack,
  storeGpsDataFromTrack,
  parseGpsDataFromLive,
  storeGpsDataFromLive,
  isTerminalOnline,
};
