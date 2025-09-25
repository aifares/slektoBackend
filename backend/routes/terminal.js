const express = require("express");
const axios = require("axios");
const router = express.Router();

const { AUTH_HEADER, TERMINAL_ID, COLORLIGHT_BASE_URL } = require("../utils");
const databaseService = require("../services/database");

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
  const { terminalIds, skipDbUpdate } = req.query;

  try {
    const targetTerminalIds = parseTerminalIds(terminalIds);

    const response = await axios.get(`${COLORLIGHT_BASE_URL}`, {
      ...AUTH_HEADER,
      params: { terminalIds: targetTerminalIds.join(",") },
    });

    const terminals = response.data;

    // Auto-update database with latest terminal data (unless explicitly disabled)
    if (skipDbUpdate !== "true") {
      const updatePromises = terminals.map(async (terminalData) => {
        try {
          // Register terminal data
          await databaseService.registerTerminalData(terminalData, true);
          console.log(
            `✅ Auto-updated terminal ${terminalData.id} in database`
          );

          // Update terminal status (online/offline tracking)
          const statusChange = await databaseService.updateTerminalStatus(
            terminalData.id,
            terminalData
          );

          // Handle playing records based on terminal status
          try {
            await databaseService.handleTerminalPlayingRecords(terminalData);
          } catch (playingError) {
            console.warn(
              `⚠️ Failed to handle playing records for terminal ${terminalData.id}:`,
              playingError.message
            );
          }
        } catch (error) {
          console.error(
            `❌ Failed to auto-update terminal ${terminalData.id}:`,
            error.message
          );
          // Don't fail the main request if database update fails
        }
      });

      // Execute all database updates in parallel (non-blocking)
      Promise.allSettled(updatePromises).catch(() => {
        // Silently handle any remaining errors to not affect the main response
      });
    }

    res.json(terminals);
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

// --- Check power status of terminals ---
router.get("/powerstatus", async (req, res) => {
  const { terminalIds, threshold } = req.query;

  try {
    // Parse terminal IDs - support query parameter or default
    let targetTerminalIds;
    if (terminalIds) {
      // Support comma-separated string or array
      targetTerminalIds =
        typeof terminalIds === "string"
          ? terminalIds.split(",").map((id) => id.trim())
          : terminalIds;
    } else {
      targetTerminalIds = [TERMINAL_ID]; // Default terminal
    }

    // Get all terminals data from the main endpoint
    const response = await axios.get(`${COLORLIGHT_BASE_URL}`, {
      ...AUTH_HEADER,
      params: { terminalIds: targetTerminalIds.join(",") },
    });

    const terminals = response.data;
    const currentTime = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
    // Allow dynamic threshold via query parameter, default to 30 seconds
    const OFFLINE_THRESHOLD = threshold ? parseInt(threshold) : 90;

    const powerStatusResults = terminals.map((terminal) => {
      const lastReportTime = terminal.post_meta?._led_latest_report_time;

      if (!lastReportTime) {
        return {
          terminalId: terminal.id,
          status: "unknown",
          message: "No report time available",
          lastReportTime: null,
          timeSinceLastReport: null,
        };
      }

      const timeSinceLastReport = currentTime - lastReportTime;
      const isOnline = timeSinceLastReport <= OFFLINE_THRESHOLD;

      return {
        terminalId: terminal.id,
        status: isOnline ? "online" : "offline",
        message: isOnline
          ? `Device is online (last report ${timeSinceLastReport}s ago)`
          : `Device is offline (last report ${timeSinceLastReport}s ago)`,
        lastReportTime,
        timeSinceLastReport,
        threshold: OFFLINE_THRESHOLD,
        lastReportDate: new Date(lastReportTime * 1000).toISOString(),
      };
    });

    const summary = {
      timestamp: new Date().toISOString(),
      currentUnixTime: currentTime,
      threshold: OFFLINE_THRESHOLD,
      requestedTerminals: targetTerminalIds,
      totalTerminals: powerStatusResults.length,
      onlineCount: powerStatusResults.filter((t) => t.status === "online")
        .length,
      offlineCount: powerStatusResults.filter((t) => t.status === "offline")
        .length,
      unknownCount: powerStatusResults.filter((t) => t.status === "unknown")
        .length,
      terminals: powerStatusResults,
    };

    res.json(summary);
  } catch (err) {
    console.error(
      "Error checking power status:",
      err.response?.data || err.message
    );
    res.status(500).json({
      error: "Failed to check power status",
      details: err.response?.data || err.message,
    });
  }
});

// --- Register terminal data to database ---
router.post("/register", async (req, res) => {
  const { terminalIds, forceUpdate } = req.body;

  try {
    const targetTerminalIds = parseTerminalIds(terminalIds);

    // Fetch terminal data from the existing endpoint
    const response = await axios.get(`${COLORLIGHT_BASE_URL}`, {
      ...AUTH_HEADER,
      params: { terminalIds: targetTerminalIds.join(",") },
    });

    const terminals = response.data;
    const registrationResults = [];
    const registrationErrors = [];

    // Process each terminal
    const skippedTerminals = [];
    for (const terminalData of terminals) {
      try {
        const result = await databaseService.registerTerminalData(
          terminalData,
          forceUpdate
        );

        if (result.skipped) {
          skippedTerminals.push({
            terminalId: terminalData.id?.toString() || "unknown",
            skipped: true,
            reason: result.reason,
          });
        } else {
          registrationResults.push({
            terminalId: terminalData.id?.toString() || "unknown",
            success: true,
            data: result,
          });
        }
      } catch (error) {
        registrationErrors.push({
          terminalId: terminalData.id?.toString() || "unknown",
          success: false,
          error: error.message,
        });
      }
    }

    const totalProcessed = registrationResults.length + skippedTerminals.length;
    const summary = {
      message: `Registration completed: ${registrationResults.length} updated, ${skippedTerminals.length} skipped, ${registrationErrors.length} failed`,
      successful: registrationResults.length,
      skipped: skippedTerminals.length,
      failed: registrationErrors.length,
      requestedTerminals: targetTerminalIds,
      results: registrationResults,
    };

    if (skippedTerminals.length > 0) {
      summary.skippedTerminals = skippedTerminals;
    }

    if (registrationErrors.length > 0) {
      summary.errors = registrationErrors;
    }

    // Return 207 Multi-Status if there are partial failures, 200 if all successful
    const statusCode = registrationErrors.length > 0 ? 207 : 200;
    res.status(statusCode).json(summary);
  } catch (err) {
    console.error("Error registering terminal data:", err.message);
    res.status(500).json({
      error: "Failed to register terminal data",
      details: err.message,
    });
  }
});

module.exports = router;
