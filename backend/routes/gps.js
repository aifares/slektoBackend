const express = require("express");
const axios = require("axios");
const router = express.Router();

const {
  COLORLIGHT_TRACK_URL,
  TRACK_AUTH_HEADER,
  TERMINAL_ID,
} = require("../utils");

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

module.exports = router;
