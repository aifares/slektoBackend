const express = require("express");
const router = express.Router();
const adaptivePoller = require("../services/adaptivePoller");

// Start the adaptive poller
router.post("/start", async (req, res) => {
  try {
    adaptivePoller.start();
    res.json({
      success: true,
      message: "Adaptive poller started",
      status: databaseService.adaptivePoller.getStatus(),
    });
  } catch (error) {
    console.error("Error starting poller:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to start poller",
      details: error.message,
    });
  }
});

// Stop the adaptive poller
router.post("/stop", async (req, res) => {
  try {
    adaptivePoller.stop();
    res.json({
      success: true,
      message: "Adaptive poller stopped",
      status: databaseService.adaptivePoller.getStatus(),
    });
  } catch (error) {
    console.error("Error stopping poller:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to stop poller",
      details: error.message,
    });
  }
});

// Get poller status
router.get("/status", async (req, res) => {
  try {
    const status = adaptivePoller.getStatus();
    res.json({
      success: true,
      status,
    });
  } catch (error) {
    console.error("Error getting poller status:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to get poller status",
      details: error.message,
    });
  }
});

// Configure poller settings
router.post("/configure", async (req, res) => {
  try {
    const {
      minInterval,
      maxInterval,
      activeTerminalThreshold,
      playingContentThreshold,
      backoffOnError,
    } = req.body;

    if (minInterval !== undefined) {
      adaptivePoller.minInterval = Math.max(30000, minInterval); // Min 30 seconds
    }
    if (maxInterval !== undefined) {
      adaptivePoller.maxInterval = Math.min(
        600000, // Max 10 minutes
        maxInterval
      );
    }
    if (activeTerminalThreshold !== undefined) {
      adaptivePoller.config.activeTerminalThreshold = Math.max(
        1,
        activeTerminalThreshold
      );
    }
    if (playingContentThreshold !== undefined) {
      adaptivePoller.config.playingContentThreshold = Math.max(
        1,
        playingContentThreshold
      );
    }
    if (backoffOnError !== undefined) {
      adaptivePoller.config.backoffOnError = Boolean(backoffOnError);
    }

    res.json({
      success: true,
      message: "Poller configuration updated",
      config: {
        minInterval: adaptivePoller.minInterval,
        maxInterval: adaptivePoller.maxInterval,
        activeTerminalThreshold: adaptivePoller.config.activeTerminalThreshold,
        playingContentThreshold: adaptivePoller.config.playingContentThreshold,
        backoffOnError: adaptivePoller.config.backoffOnError,
      },
    });
  } catch (error) {
    console.error("Error configuring poller:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to configure poller",
      details: error.message,
    });
  }
});

module.exports = router;
