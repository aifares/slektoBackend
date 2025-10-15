const { supabase } = require("../config/supabase");
const { detectZone } = require("./zoneDetection");

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
async function parseGpsDataFromTrack(terminalId, trackResponse) {
  if (!trackResponse?.data || !Array.isArray(trackResponse.data)) {
    return [];
  }

  const parsedPoints = [];

  for (const point of trackResponse.data) {
    // Use serverTime as the recorded timestamp (UTC)
    const recordedAt = new Date();
    const dataDate = recordedAt.toISOString().split("T")[0]; // YYYY-MM-DD format

    const latitude = Number(point.latitude);
    const longitude = Number(point.longitude);

    // Detect zone for this GPS point
    const zone = await detectZone(latitude, longitude);

    parsedPoints.push({
      terminal_id: terminalId.toString(),
      data_date: dataDate,
      longitude: longitude,
      latitude: latitude,
      recorded_at: recordedAt.toISOString(),
      zone_id: zone?.id || null,
    });
  }

  return parsedPoints;
}

// Function to store GPS data from track API response
async function storeGpsDataFromTrack(terminalId, trackResponse) {
  const gpsPoints = await parseGpsDataFromTrack(terminalId, trackResponse);

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
async function parseGpsDataFromLive(terminalId, liveData) {
  if (!liveData?.latitude || !liveData?.longitude) {
    return [];
  }

  // Use serverTime as the recorded timestamp if available, otherwise use current time
  const recordedAt = new Date();
  const dataDate = recordedAt.toISOString().split("T")[0]; // YYYY-MM-DD format

  const latitude = Number(liveData.latitude);
  const longitude = Number(liveData.longitude);

  // Detect zone for this GPS point
  const zone = await detectZone(latitude, longitude);

  return [
    {
      terminal_id: terminalId.toString(),
      data_date: dataDate,
      longitude: longitude,
      latitude: latitude,
      recorded_at: recordedAt.toISOString(),
      zone_id: zone?.id || null,
    },
  ];
}

// Function to store GPS data from live API response
async function storeGpsDataFromLive(terminalId, liveData) {
  const gpsPoints = await parseGpsDataFromLive(terminalId, liveData);

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
