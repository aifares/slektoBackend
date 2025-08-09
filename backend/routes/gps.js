const express = require("express");
const axios = require("axios");
const router = express.Router();

const { AUTH_HEADER, TERMINAL_ID, COLORLIGHT_BASE_URL } = require("../utils");

// --- Get GPS info for hardcoded terminal ---
router.get("/", async (req, res) => {
  try {
    const response = await axios.get(
      `${COLORLIGHT_BASE_URL}/terminals/${TERMINAL_ID}`,
      AUTH_HEADER
    );
    // GPS info might be inside response.data.geo_coordinate or similar
    const gps = response.data.geo_coordinate || null;
    res.json({ gps });
  } catch (err) {
    console.error(
      "Error fetching GPS info:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to fetch GPS info",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
