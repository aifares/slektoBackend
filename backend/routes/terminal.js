const express = require("express");
const axios = require("axios");
const router = express.Router();

const { AUTH_HEADER, TERMINAL_ID, COLORLIGHT_BASE_URL } = require("../utils");

// --- Get all terminals ---
router.get("/", async (req, res) => {
  const terminalIds = TERMINAL_ID;

  try {
    const response = await axios.get(`${COLORLIGHT_BASE_URL}/terminals`, {
      ...AUTH_HEADER,
      params: { terminalIds },
    });
    res.json(response.data);
  } catch (err) {
    console.error(
      "Error fetching terminals:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to fetch terminals",
      details: err.response?.data || err.message,
    });
  }
});

// --- Register a terminal ---
router.post("/register", async (req, res) => {
  const { sn, name } = req.body;

  if (!sn || !name) {
    return res
      .status(400)
      .json({ error: 'Missing "sn" or "name" in request body' });
  }

  try {
    const response = await axios.post(
      `${COLORLIGHT_BASE_URL}/terminals`,
      { sn, name },
      AUTH_HEADER
    );
    res.json({ message: "Terminal registered", data: response.data });
  } catch (err) {
    console.error(
      "Error registering terminal:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to register terminal",
      details: err.response?.data || err.message,
    });
  }
});

// --- Put terminal to sleep ---
router.post("/sleep", async (req, res) => {
  try {
    const response = await axios.post(
      "https://us33.colorlightcloud.com/wp-json/wp/v2/comments",
      {
        post: Number(TERMINAL_ID),
        metadata: {
          act_url: "api/action",
          act_method: 1,
        },
        content: JSON.stringify({ command: "sleep" }),
      },
      AUTH_HEADER
    );
    res.json({ message: "Terminal put to sleep", data: response.data });
  } catch (err) {
    console.error(
      "Error putting terminal to sleep:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to put terminal to sleep",
      details: err.response?.data || err.message,
    });
  }
});

// --- Wake terminal up ---
router.post("/wake", async (req, res) => {
  try {
    const response = await axios.post(
      "https://us33.colorlightcloud.com/wp-json/wp/v2/comments",
      {
        post: Number(TERMINAL_ID),
        metadata: {
          act_url: "api/action",
          act_method: 1,
        },
        content: JSON.stringify({ command: "wakeup" }), // note "wakeup"
      },
      AUTH_HEADER
    );
    res.json({ message: "Terminal woken up", data: response.data });
  } catch (err) {
    console.error(
      "Error waking terminal up:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to wake terminal up",
      details: err.response?.data || err.message,
    });
  }
});

// --- Set terminal brightness ---
router.post("/brightness", async (req, res) => {
  const { brightness } = req.body;

  if (brightness === undefined) {
    return res
      .status(400)
      .json({ error: 'Missing "brightness" in request body' });
  }

  if (typeof brightness !== "number" || brightness < 0 || brightness > 100) {
    return res
      .status(400)
      .json({ error: "Brightness must be a number between 0 and 100" });
  }

  try {
    const response = await axios.post(
      "https://us33.colorlightcloud.com/wp-json/wp/v2/comments/batch",
      {
        groupId: 0,
        posts: [Number(TERMINAL_ID)],
        commentData: {
          metadata: {
            act_url: "api/brightness",
            act_method: 2,
          },
          content: JSON.stringify({ brightness }),
        },
      },
      AUTH_HEADER
    );
    res.json({
      message: `Brightness set to ${brightness}`,
      data: response.data,
    });
  } catch (err) {
    console.error(
      "Error setting brightness:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to set brightness",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
