const express = require("express");
const axios = require("axios");
const router = express.Router();

const {
  TERMINAL_ID,
  TRACK_AUTH_HEADER,
  COLORLIGHT_TRACK_URL,
  COLORLIGHT_LATEST_URL,
} = require("../utils");

// --- Get current GPS info for hardcoded terminal ---
router.get("/current", async (req, res) => {
  try {
    const response = await axios.post(
      COLORLIGHT_LATEST_URL,
      {
        terminalId: TERMINAL_ID,
      },
      TRACK_AUTH_HEADER
    );

    res.json({ gps: response.data });
  } catch (err) {
    console.error(
      "Error fetching current GPS info:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to fetch current GPS info",
      details: err.response?.data || err.message,
    });
  }
});

router.post("/track", async (req, res) => {
  const { startTime, endTime } = req.body;

  if (!startTime || !endTime) {
    return res.status(400).json({
      error: "startTime and endTime are required in the request body.",
    });
  }
  try {
    const response = await axios.post(
      COLORLIGHT_TRACK_URL,
      {
        terminalId: TERMINAL_ID,
        startTime,
        endTime,
      },
      TRACK_AUTH_HEADER
    );

    res.json(response.data);
  } catch (err) {
    console.error(
      "Error fetching GPS track info:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to fetch GPS track info",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
