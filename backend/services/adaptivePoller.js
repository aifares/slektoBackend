const axios = require("axios");
const databaseService = require("./database");
const { determineOnlineStatus } = require("./statusTracking");

class AdaptivePoller {
  constructor() {
    this.pollInterval = 180000; // Start with 3 minutes
    this.maxInterval = 180000; // Max 3 minutes
    this.minInterval = 180000; // Min 3 minutes
    this.backoffMultiplier = 1.5; // Increase interval on errors
    this.isPolling = false;
    this.lastTerminalState = null;
    this.errorCount = 0;
    this.maxErrors = 5;

    // Configuration
    this.config = {
      activeTerminalThreshold: 1, // Consider active if 1+ terminals online
      playingContentThreshold: 1, // Consider active if 1+ terminals playing content
      backoffOnError: true,
    };
  }

  start() {
    if (this.isPolling) {
      console.log("⚠️ Poller is already running");
      return;
    }

    console.log("🚀 Starting adaptive terminal poller");
    this.isPolling = true;
    this.poll();
  }

  stop() {
    console.log("🛑 Stopping adaptive terminal poller");
    this.isPolling = false;
  }

  async poll() {
    if (!this.isPolling) return;

    try {
      const startTime = Date.now();

      // Get terminal data
      const terminals = await this.fetchTerminals();

      // Always process terminal data
      await this.processTerminals(terminals);
      this.lastTerminalState = this.serializeTerminals(terminals);
      this.errorCount = 0; // Reset error count on success

      // Calculate next poll interval
      const processingTime = Date.now() - startTime;
      this.adjustPollInterval(terminals, processingTime);

      console.log(
        `⏰ Next poll in ${this.pollInterval}ms (${this.getActivityLevel(
          terminals
        )})`
      );
    } catch (error) {
      console.error("❌ Polling error:", error.message);
      this.handlePollingError();
    }

    // Schedule next poll
    if (this.isPolling) {
      setTimeout(() => this.poll(), this.pollInterval);
    }
  }

  async fetchTerminals() {
    const { COLORLIGHT_BASE_URL, AUTH_HEADER } = require("../utils");

    const response = await axios.get(`${COLORLIGHT_BASE_URL}`, {
      ...AUTH_HEADER,
      timeout: 10000, // 10 second timeout
    });

    return response.data;
  }

  async processTerminals(terminals) {
    console.log(`🔄 Processing ${terminals.length} terminals`);

    const updatePromises = terminals.map(async (terminalData) => {
      try {
        // Register terminal data (without playing records - we'll handle those separately)
        await databaseService.registerTerminalData(terminalData, true, true); // Skip playing records

        // Update terminal status
        const statusChange = await databaseService.updateTerminalStatus(
          terminalData.id,
          terminalData
        );

        // Handle playing records with current timestamp
        await databaseService.handleTerminalPlayingRecords(terminalData);

        return { terminalId: terminalData.id, success: true };
      } catch (error) {
        console.error(
          `❌ Failed to process terminal ${terminalData.id}:`,
          error.message
        );
        return {
          terminalId: terminalData.id,
          success: false,
          error: error.message,
        };
      }
    });

    // Execute all updates in parallel
    const results = await Promise.allSettled(updatePromises);

    // Log results
    const successful = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;
    const failed = results.length - successful;

    if (successful > 0) {
      console.log(`✅ Successfully processed ${successful} terminals`);
    }
    if (failed > 0) {
      console.warn(`⚠️ Failed to process ${failed} terminals`);
    }

    // Sync programs from API (non-blocking, happens after terminal processing)
    try {
      await databaseService.syncProgramsFromAPI();
    } catch (programError) {
      console.warn(
        `⚠️ Failed to sync programs (non-critical):`,
        programError.message
      );
      // Don't fail terminal processing if program sync fails
    }
  }

  serializeTerminals(terminals) {
    // Create a simplified representation for change detection
    return terminals
      .map((t) => ({
        id: t.id,
        online: this.isTerminalOnline(t),
        playing: this.isTerminalPlaying(t),
        lastReport: t.post_meta?._led_latest_report_time,
      }))
      .sort((a, b) => a.id - b.id)
      .join("|");
  }

  isTerminalOnline(terminal) {
    const { isOnline } = determineOnlineStatus(terminal);
    return isOnline;
  }

  isTerminalPlaying(terminal) {
    const playingData =
      terminal.post_meta?._led_status?.vsns?.playing ||
      terminal.post_meta?._led_status?.info?.info?.playing;
    return !!(playingData && playingData.name);
  }

  adjustPollInterval(terminals, processingTime) {
    const activeTerminals = terminals.filter((t) =>
      this.isTerminalOnline(t)
    ).length;
    const playingTerminals = terminals.filter((t) =>
      this.isTerminalPlaying(t)
    ).length;

    const isActive =
      activeTerminals >= this.config.activeTerminalThreshold ||
      playingTerminals >= this.config.playingContentThreshold;

    if (isActive) {
      // More active - poll more frequently
      this.pollInterval = Math.max(this.minInterval, this.pollInterval * 0.8);
    } else {
      // Less active - poll less frequently
      this.pollInterval = Math.min(this.maxInterval, this.pollInterval * 1.1);
    }

    // Adjust for processing time (don't poll faster than we can process)
    const minProcessingInterval = processingTime * 2;
    this.pollInterval = Math.max(this.pollInterval, minProcessingInterval);
  }

  getActivityLevel(terminals) {
    const activeTerminals = terminals.filter((t) =>
      this.isTerminalOnline(t)
    ).length;
    const playingTerminals = terminals.filter((t) =>
      this.isTerminalPlaying(t)
    ).length;

    if (playingTerminals > 0) return `HIGH (${playingTerminals} playing)`;
    if (activeTerminals > 0) return `MEDIUM (${activeTerminals} online)`;
    return "LOW (all offline)";
  }

  handlePollingError() {
    this.errorCount++;

    if (this.errorCount >= this.maxErrors) {
      console.error(
        `❌ Too many consecutive errors (${this.errorCount}), stopping poller`
      );
      this.stop();
      return;
    }

    if (this.config.backoffOnError) {
      // Exponential backoff on errors
      this.pollInterval = Math.min(
        this.maxInterval,
        this.pollInterval * this.backoffMultiplier
      );
      console.log(
        `⏰ Backing off due to error, next poll in ${this.pollInterval}ms`
      );
    }
  }

  getStatus() {
    return {
      isPolling: this.isPolling,
      pollInterval: this.pollInterval,
      errorCount: this.errorCount,
      lastState: this.lastTerminalState ? "available" : "none",
    };
  }
}

// Create singleton instance
const adaptivePoller = new AdaptivePoller();

module.exports = adaptivePoller;
