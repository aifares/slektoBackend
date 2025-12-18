const express = require("express");
const bodyParser = require("body-parser");
const compression = require("compression");

const terminalRoutes = require("./routes/terminal");
const contentRoutes = require("./routes/content");
const gpsRoutes = require("./routes/gps");
const playingRoutes = require("./routes/playing");
const statusRoutes = require("./routes/status");
const clientsRoutes = require("./routes/clients");
const clientDataRoutes = require("./routes/clientData");
const programsRoutes = require("./routes/programs");
const analyticsRoutes = require("./routes/analytics");
const campaignsRoutes = require("./routes/campaigns");
const clientGpsRoutes = require("./routes/clientGps");
const publicRoutes = require("./routes/public");
const pollerRoutes = require("./routes/poller");
const driversRoutes = require("./routes/drivers");
const adminRoutes = require("./routes/admin");
const adminCampaignsRoutes = require("./routes/adminCampaigns");
const { authMiddleware } = require("./middleware/auth");

const app = express();
app.use(compression());
app.use(bodyParser.json());

const PORT = 3000;

// Public routes (no auth)
app.use("/public", publicRoutes);

// Public driver registration (no auth required)
const { registerDriver } = require("./services/driverRegistration");
app.post("/drivers/register", async (req, res) => {
  try {
    const result = await registerDriver(req.body);
    if (!result.success) {
      const response = { error: result.error };
      if (result.details) response.details = result.details;
      if (result.driverId) response.driverId = result.driverId;
      if (result.driverStatus) response.status = result.driverStatus;
      return res.status(result.status).json(response);
    }
    return res.status(result.status).json({
      success: true,
      message: result.message,
      driver: result.driver,
    });
  } catch (err) {
    console.error("❌ Unexpected error in driver registration:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// Protect all other routes with auth
app.use(authMiddleware);
app.use("/drivers", driversRoutes);
app.use("/terminals", terminalRoutes);
app.use("/content", contentRoutes);
app.use("/gps", gpsRoutes);
app.use("/playing", playingRoutes);
app.use("/status", statusRoutes);
app.use("/clients", clientsRoutes);
app.use("/clientData", clientDataRoutes);
app.use("/programs", programsRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/campaigns", campaignsRoutes);
app.use("/client/gps", clientGpsRoutes);
app.use("/poller", pollerRoutes);
app.use("/admin", adminRoutes);
app.use("/admin", adminCampaignsRoutes); // Campaign management endpoints

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

  // Note: Media sync runs via cron (see cron/crontab)
  // Schedule: Daily at 2:00 AM
  console.log("ℹ️  Media sync scheduled via cron (daily at 2:00 AM)");
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
