const express = require("express");
const axios = require("axios");
const router = express.Router();

const {
  COLORLIGHT_TRACK_URL,
  COLORLIGHT_LIVE_URL,
  COLORLIGHT_BASE_URL,
  TRACK_AUTH_HEADER,
  AUTH_HEADER,
  TERMINAL_ID,
} = require("../utils");

// Helper function to get power status for a terminal (extracted from terminal.js)
async function getTerminalPowerStatus(terminalId, threshold = 90) {
  try {
    const response = await axios.get(`${COLORLIGHT_BASE_URL}`, {
      ...AUTH_HEADER,
      params: { terminalIds: terminalId },
    });

    const terminals = response.data;
    const terminal = terminals[0];

    if (!terminal) {
      return {
        found: false,
        error: "Terminal not found",
      };
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const lastReportTime = terminal.post_meta?._led_latest_report_time;

    if (!lastReportTime) {
      return {
        found: true,
        terminalId: terminal.id,
        status: "unknown",
        isOnline: false,
        message: "No report time available",
        lastReportTime: null,
        timeSinceLastReport: null,
        threshold,
      };
    }

    const timeSinceLastReport = currentTime - lastReportTime;
    const isOnline = timeSinceLastReport <= threshold;

    return {
      found: true,
      terminalId: terminal.id,
      status: isOnline ? "online" : "offline",
      isOnline,
      message: isOnline
        ? `Device is online (last report ${timeSinceLastReport}s ago)`
        : `Device is offline (last report ${timeSinceLastReport}s ago)`,
      lastReportTime,
      timeSinceLastReport,
      threshold,
      lastReportDate: new Date(lastReportTime * 1000).toISOString(),
    };
  } catch (error) {
    return {
      found: false,
      error: error.response?.data || error.message,
    };
  }
}

// --- Get GPS track data for a terminal ---
router.post("/track", async (req, res) => {
  const { terminalId, startTime, endTime } = req.body;

  // Use provided terminalId or default to TERMINAL_ID from config
  const targetTerminalId = terminalId || TERMINAL_ID;

  // Validate required parameters
  if (!startTime || !endTime) {
    return res.status(400).json({
      error:
        'Missing required parameters: "startTime" and "endTime" are required',
      example: {
        terminalId: "2355209",
        startTime: "2025-08-15T00:46:36",
        endTime: "2025-09-13T00:46:37",
      },
    });
  }

  // Validate date format (basic ISO string check)
  const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  if (!dateRegex.test(startTime) || !dateRegex.test(endTime)) {
    return res.status(400).json({
      error: "Invalid date format. Use ISO format: YYYY-MM-DDTHH:mm:ss",
      example: {
        startTime: "2025-08-15T00:46:36",
        endTime: "2025-09-13T00:46:37",
      },
    });
  }

  try {
    const response = await axios.post(
      COLORLIGHT_TRACK_URL,
      {
        terminalId: targetTerminalId,
        startTime,
        endTime,
      },
      TRACK_AUTH_HEADER
    );

    res.json({
      message: "GPS track data retrieved successfully",
      terminalId: targetTerminalId,
      startTime,
      endTime,
      data: response.data,
    });
  } catch (err) {
    console.error(
      "Error fetching GPS track data:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to fetch GPS track data",
      details: err.response?.data || err.message,
    });
  }
});

// Helper function to parse terminal IDs (supports single, array, or all)
function parseTerminalIdsForGPS(terminalId, terminalIds, availableTerminals) {
  // If terminalIds array is provided, use it
  if (terminalIds && Array.isArray(terminalIds) && terminalIds.length > 0) {
    return terminalIds.map((id) => id.toString());
  }

  // If single terminalId is provided, use it
  if (terminalId) {
    return [terminalId.toString()];
  }

  // If nothing provided, return all available terminals from GPS data
  return availableTerminals.map((terminal) => terminal.terminalId.toString());
}

// --- Get live GPS info for terminal(s) with online status ---
router.post("/live", async (req, res) => {
  const { terminalId, terminalIds, threshold } = req.body;

  try {
    // Get live GPS data from the group endpoint (hardcoded group ID 6640)
    const gpsResponse = await axios.post(
      COLORLIGHT_LIVE_URL,
      {
        terminalGroupId: 6640,
      },
      TRACK_AUTH_HEADER
    );

    const allGpsData = gpsResponse.data;

    if (!allGpsData || allGpsData.length === 0) {
      return res.status(404).json({
        error: "No terminals found in GPS data",
        message: "No terminals are currently reporting GPS data in group 6640",
      });
    }

    // Parse which terminals to process
    const targetTerminalIds = parseTerminalIdsForGPS(
      terminalId,
      terminalIds,
      allGpsData
    );

    // If no specific terminals requested and no GPS data available, use default
    if (targetTerminalIds.length === 0) {
      targetTerminalIds.push(TERMINAL_ID);
    }

    // Process each terminal
    const terminalResults = [];
    const terminalErrors = [];

    for (const targetTerminalId of targetTerminalIds) {
      try {
        // Find the specific terminal in the GPS data
        const terminalGpsData = allGpsData.find(
          (terminal) =>
            terminal.terminalId.toString() === targetTerminalId.toString()
        );

        if (!terminalGpsData) {
          terminalErrors.push({
            terminalId: targetTerminalId,
            error: "Terminal not found in GPS data",
            message: "Terminal may be offline or not in the configured group",
          });
          continue;
        }

        // Get power status for the terminal
        const powerStatus = await getTerminalPowerStatus(
          targetTerminalId,
          threshold
        );

        if (!powerStatus.found) {
          terminalErrors.push({
            terminalId: targetTerminalId,
            error: "Terminal not found in power status check",
            details: powerStatus.error,
          });
          continue;
        }

        // Combine GPS data with power status
        terminalResults.push({
          terminalId: targetTerminalId,
          isOnline: powerStatus.isOnline,
          status: powerStatus.status,
          statusMessage: powerStatus.message,
          lastReportTime: powerStatus.lastReportTime,
          timeSinceLastReport: powerStatus.timeSinceLastReport,
          threshold: powerStatus.threshold,
          lastReportDate: powerStatus.lastReportDate,
          gpsData: terminalGpsData,
        });
      } catch (terminalError) {
        terminalErrors.push({
          terminalId: targetTerminalId,
          error: "Processing error",
          details: terminalError.message,
        });
      }
    }

    // Determine response format based on request type
    const isSingleTerminalRequest = terminalId && !terminalIds;

    if (isSingleTerminalRequest && terminalResults.length === 1) {
      // Backward compatibility: return single terminal object for single requests
      const result = terminalResults[0];
      res.json({
        message: "Live GPS data with power status retrieved successfully",
        ...result,
      });
    } else {
      // Multi-terminal response format
      const summary = {
        message: `Live GPS data retrieved for ${terminalResults.length} terminal(s)`,
        requestedTerminals: targetTerminalIds,
        totalTerminals: terminalResults.length,
        successfulTerminals: terminalResults.length,
        failedTerminals: terminalErrors.length,
        onlineCount: terminalResults.filter((t) => t.isOnline).length,
        offlineCount: terminalResults.filter((t) => !t.isOnline).length,
        terminals: terminalResults,
      };

      if (terminalErrors.length > 0) {
        summary.errors = terminalErrors;
      }

      // Return 207 Multi-Status if there are partial failures, 200 if all successful
      const statusCode = terminalErrors.length > 0 ? 207 : 200;
      res.status(statusCode).json(summary);
    }
  } catch (err) {
    console.error(
      "Error fetching live GPS data:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to fetch live GPS data",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
