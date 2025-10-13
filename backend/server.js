const express = require("express");
const bodyParser = require("body-parser");

const terminalRoutes = require("./routes/terminal");
const contentRoutes = require("./routes/content");
const gpsRoutes = require("./routes/gps");
const playingRoutes = require("./routes/playing");
const statusRoutes = require("./routes/status");
const clientsRoutes = require("./routes/clients");
const clientDataRoutes = require("./routes/clientData");
const programsRoutes = require("./routes/programs");
const analyticsRoutes = require("./routes/analytics");
const clientGpsRoutes = require("./routes/clientGps");
const testRoutes = require("./routes/test");
const publicRoutes = require("./routes/public");
const pollerRoutes = require("./routes/poller");
const { authMiddleware } = require("./middleware/auth");

const app = express();
app.use(bodyParser.json());

const PORT = 3000;

// Public routes (no auth)
app.use("/public", publicRoutes);
app.use("/test", testRoutes);

// Protect all other routes with auth
app.use(authMiddleware);
app.use("/terminals", terminalRoutes);
app.use("/content", contentRoutes);
app.use("/gps", gpsRoutes);
app.use("/playing", playingRoutes);
app.use("/status", statusRoutes);
app.use("/clients", clientsRoutes);
app.use("/clientData", clientDataRoutes);
app.use("/programs", programsRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/client/gps", clientGpsRoutes);
app.use("/poller", pollerRoutes);

const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);

  // Auto-start the adaptive poller if enabled
  if (process.env.AUTO_START_POLLER !== "false") {
    const adaptivePoller = require("./services/adaptivePoller");
    console.log("🚀 Auto-starting adaptive poller...");
    adaptivePoller.start();
  } else {
    console.log("⏸️ Auto-start poller disabled (AUTO_START_POLLER=false)");
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully...");
  const adaptivePoller = require("./services/adaptivePoller");
  adaptivePoller.stop();
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received, shutting down gracefully...");
  const adaptivePoller = require("./services/adaptivePoller");
  adaptivePoller.stop();
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});
