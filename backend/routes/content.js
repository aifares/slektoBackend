const express = require("express");
const axios = require("axios");
const router = express.Router();

const { AUTH_HEADER, TERMINAL_ID } = require("../utils");

// --- List programs for hardcoded terminal ---
router.get("/programs", async (req, res) => {
  try {
    const response = await axios.get(
      "https://us33.colorlightcloud.com/wp-json/wp/v2/programs",
      {
        headers: {
          Authorization: "Basic QWxpRmFyZXM6SHgxMjM0NTZAIw==",
          "User-Agent": "Mozilla/5.0",
          Referer: "https://us33.colorlightcloud.com/home",
          Accept: "application/json",
        },
        params: {
          terminalId: TERMINAL_ID,
        },
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error(
      "Error fetching programs:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to fetch programs",
      details: err.response?.data || err.message,
    });
  }
});

// --- Publish a program to a terminal ---
router.post("/publish", async (req, res) => {
  const { playlistName } = req.body;
  if (!playlistName) {
    return res
      .status(400)
      .json({ error: 'Missing "playlistName" in request body' });
  }

  try {
    // 1. Fetch all programs
    const programsResponse = await axios.get(
      "https://us33.colorlightcloud.com/wp-json/wp/v2/programs",
      {
        ...AUTH_HEADER,
        params: {
          terminalId: TERMINAL_ID,
        },
      }
    );

    const programs = programsResponse.data;

    // 2. Find the program with the matching playlistName
    const program = programs.find((p) => p.title.rendered === playlistName);

    if (!program) {
      return res
        .status(404)
        .json({ error: `Playlist "${playlistName}" not found` });
    }

    const programFileName = program.vsn_name;
    console.log(programFileName);
    // 3. Publish the program
    const response = await axios.post(
      `https://us33.colorlightcloud.com/wp-json/wp/v2/comments?post=${TERMINAL_ID}`,
      {
        metadata: {
          act_url: `api/vsns/sources/internet/vsns/${programFileName}/activated`,
          act_method: 2,
        },
        content: JSON.stringify({ command: "" }),
      },
      AUTH_HEADER
    );

    res.json({ message: "Program activated", data: response.data });
  } catch (err) {
    console.error(
      "Error activating program:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to activate program",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = router;
