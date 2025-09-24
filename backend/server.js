const express = require("express");
const bodyParser = require("body-parser");

const terminalRoutes = require("./routes/terminal");
const contentRoutes = require("./routes/content");
const gpsRoutes = require("./routes/gps");
const playingRoutes = require("./routes/playing");
const statusRoutes = require("./routes/status");
const clientsRoutes = require("./routes/clients");
const clientDataRoutes = require("./routes/clientData");
const testRoutes = require("./routes/test");
const publicRoutes = require("./routes/public");
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

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
