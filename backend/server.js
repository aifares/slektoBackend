const express = require("express");
const bodyParser = require("body-parser");

const terminalRoutes = require("./routes/terminal");
const contentRoutes = require("./routes/content");
const gpsRoutes = require("./routes/gps");

const app = express();
app.use(bodyParser.json());

const PORT = 3000;

app.use("/terminals", terminalRoutes);
app.use("/content", contentRoutes);
app.use("/gps", gpsRoutes);

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
