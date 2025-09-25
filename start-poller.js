#!/usr/bin/env node

const adaptivePoller = require("./backend/services/adaptivePoller");

console.log("🚀 Starting Adaptive Terminal Poller...");
console.log("📊 Polling frequencies:");
console.log("   HIGH activity (terminals playing): 60 seconds");
console.log("   MEDIUM activity (terminals online): 60-120 seconds");
console.log("   LOW activity (all offline): 5 minutes");

// Start the poller
adaptivePoller.start();

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down poller...");
  adaptivePoller.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down poller...");
  adaptivePoller.stop();
  process.exit(0);
});

// Keep the process alive
setInterval(() => {
  const status = adaptivePoller.getStatus();
  console.log(
    `📊 Poller Status: ${
      status.isPolling ? "RUNNING" : "STOPPED"
    } | Interval: ${status.pollInterval}ms | Errors: ${status.errorCount}`
  );
}, 30000); // Status update every 30 seconds
