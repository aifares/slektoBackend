const express = require("express");
const axios = require("axios");
const router = express.Router();

const { AUTH_HEADER, TERMINAL_ID, COLORLIGHT_BASE_URL } = require("../utils");

// Helper function to execute commands on multiple terminals
async function executeCommandOnTerminals(terminalIds, commandData) {
  const results = [];
  const errors = [];

  for (const terminalId of terminalIds) {
    try {
      const response = await axios.post(
        "https://us33.colorlightcloud.com/wp-json/wp/v2/comments",
        {
          post: Number(terminalId),
          ...commandData,
        },
        AUTH_HEADER
      );
      results.push({
        terminalId,
        success: true,
        data: response.data,
      });
    } catch (err) {
      errors.push({
        terminalId,
        success: false,
        error: err.response?.data || err.message,
      });
    }
  }

  return { results, errors };
}

// Helper function to validate and parse terminal IDs
function parseTerminalIds(terminalIds) {
  if (!terminalIds) {
    return [TERMINAL_ID]; // Default to configured terminal ID
  }

  if (typeof terminalIds === "string") {
    return [terminalIds];
  }

  if (Array.isArray(terminalIds)) {
    if (terminalIds.length === 0) {
      return [TERMINAL_ID];
    }
    return terminalIds;
  }

  throw new Error("terminalIds must be a string or array of strings");
}

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

// --- Put terminals to sleep ---
router.post("/sleep", async (req, res) => {
  const { terminalIds } = req.body;

  try {
    const targetTerminalIds = parseTerminalIds(terminalIds);

    const commandData = {
      metadata: {
        act_url: "api/action",
        act_method: 1,
      },
      content: JSON.stringify({ command: "sleep" }),
    };

    const { results, errors } = await executeCommandOnTerminals(
      targetTerminalIds,
      commandData
    );

    const summary = {
      message: `Sleep command executed on ${results.length} terminal(s)`,
      successful: results.length,
      failed: errors.length,
      results,
    };

    if (errors.length > 0) {
      summary.errors = errors;
    }

    // Return 207 Multi-Status if there are partial failures, 200 if all successful
    const statusCode = errors.length > 0 ? 207 : 200;
    res.status(statusCode).json(summary);
  } catch (err) {
    console.error("Error putting terminals to sleep:", err.message);
    res.status(500).json({
      error: "Failed to put terminals to sleep",
      details: err.message,
    });
  }
});

// --- Wake terminals up ---
router.post("/wake", async (req, res) => {
  const { terminalIds } = req.body;

  try {
    const targetTerminalIds = parseTerminalIds(terminalIds);

    const commandData = {
      metadata: {
        act_url: "api/action",
        act_method: 1,
      },
      content: JSON.stringify({ command: "wakeup" }),
    };

    const { results, errors } = await executeCommandOnTerminals(
      targetTerminalIds,
      commandData
    );

    const summary = {
      message: `Wake command executed on ${results.length} terminal(s)`,
      successful: results.length,
      failed: errors.length,
      results,
    };

    if (errors.length > 0) {
      summary.errors = errors;
    }

    const statusCode = errors.length > 0 ? 207 : 200;
    res.status(statusCode).json(summary);
  } catch (err) {
    console.error("Error waking terminals up:", err.message);
    res.status(500).json({
      error: "Failed to wake terminals up",
      details: err.message,
    });
  }
});

// --- Set terminals brightness ---
router.post("/brightness", async (req, res) => {
  const { brightness, terminalIds } = req.body;

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
    const targetTerminalIds = parseTerminalIds(terminalIds);

    const commandData = {
      metadata: {
        act_url: "api/brightness",
        act_method: 2,
      },
      content: JSON.stringify({ brightness }),
    };

    const { results, errors } = await executeCommandOnTerminals(
      targetTerminalIds,
      commandData
    );

    const summary = {
      message: `Brightness set to ${brightness} on ${results.length} terminal(s)`,
      brightness,
      successful: results.length,
      failed: errors.length,
      results,
    };

    if (errors.length > 0) {
      summary.errors = errors;
    }

    const statusCode = errors.length > 0 ? 207 : 200;
    res.status(statusCode).json(summary);
  } catch (err) {
    console.error("Error setting brightness:", err.message);
    res.status(500).json({
      error: "Failed to set brightness",
      details: err.message,
    });
  }
});

// --- Set GPS reporting interval ---
router.post("/gps-reporting", async (req, res) => {
  const { interval, terminalIds } = req.body;

  // Validate interval parameter
  if (interval === undefined) {
    return res.status(400).json({
      error: 'Missing "interval" in request body',
      description:
        "GPS reporting interval in seconds. Use 0 to disable GPS reporting.",
      example: { interval: 30, terminalIds: ["2355209"] },
    });
  }

  if (typeof interval !== "number" || interval < 0) {
    return res.status(400).json({
      error: "Interval must be a non-negative number",
      description: "Interval in seconds. Use 0 to disable GPS reporting.",
      example: { interval: 30, terminalIds: ["2355209"] },
    });
  }

  try {
    const targetTerminalIds = parseTerminalIds(terminalIds);

    const commandData = {
      metadata: {
        act_url: "api/setreporttime",
        act_method: 1,
      },
      content: JSON.stringify({ "gps.report.interval": interval }),
    };

    const { results, errors } = await executeCommandOnTerminals(
      targetTerminalIds,
      commandData
    );

    const message =
      interval === 0
        ? `GPS reporting disabled on ${results.length} terminal(s)`
        : `GPS reporting interval set to ${interval} seconds on ${results.length} terminal(s)`;

    const summary = {
      message,
      interval,
      successful: results.length,
      failed: errors.length,
      results,
    };

    if (errors.length > 0) {
      summary.errors = errors;
    }

    const statusCode = errors.length > 0 ? 207 : 200;
    res.status(statusCode).json(summary);
  } catch (err) {
    console.error("Error setting GPS reporting interval:", err.message);
    res.status(500).json({
      error: "Failed to set GPS reporting interval",
      details: err.message,
    });
  }
});

// --- Reboot terminals ---
router.post("/reboot", async (req, res) => {
  const { terminalIds } = req.body;

  try {
    const targetTerminalIds = parseTerminalIds(terminalIds);

    const commandData = {
      metadata: {
        act_url: "api/action",
        act_method: 1,
      },
      content: JSON.stringify({ command: "reboot" }),
    };

    const { results, errors } = await executeCommandOnTerminals(
      targetTerminalIds,
      commandData
    );

    const summary = {
      message: `Reboot command sent to ${results.length} terminal(s)`,
      successful: results.length,
      failed: errors.length,
      results,
    };

    if (errors.length > 0) {
      summary.errors = errors;
    }

    const statusCode = errors.length > 0 ? 207 : 200;
    res.status(statusCode).json(summary);
  } catch (err) {
    console.error("Error rebooting terminals:", err.message);
    res.status(500).json({
      error: "Failed to reboot terminals",
      details: err.message,
    });
  }
});

module.exports = router;
