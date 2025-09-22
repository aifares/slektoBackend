const axios = require("axios");
const { COLORLIGHT_TRACK_URL, TRACK_AUTH_HEADER } = require("../utils");
const db = require("../services/database");

function toUtcDateString(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toIsoAtUtc(date, h, m, s) {
  const dt = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      h,
      m,
      s
    )
  );
  // Trim milliseconds for API format YYYY-MM-DDTHH:mm:ss
  return dt.toISOString().slice(0, 19);
}

function parseArgs() {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  if (arg) {
    const value = arg.split("=")[1];
    const dt = new Date(`${value}T00:00:00Z`);
    if (!isNaN(dt.getTime())) return dt;
  }
  // default to yesterday in UTC
  const now = new Date();
  const utcYesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
  );
  return utcYesterday;
}

async function fetchTrackForTerminal(terminalId, startTime, endTime) {
  const payload = { terminalId: terminalId.toString(), startTime, endTime };
  const resp = await axios.post(
    COLORLIGHT_TRACK_URL,
    payload,
    TRACK_AUTH_HEADER
  );
  return resp.data;
}

async function run() {
  const targetDay = parseArgs();
  const dataDate = toUtcDateString(targetDay);
  // Query from 12:01 AM to 11:59 PM (UTC)
  const startTime = toIsoAtUtc(targetDay, 0, 1, 0); // 00:01:00
  const endTime = toIsoAtUtc(targetDay, 23, 59, 59); // 23:59:59

  console.log(`🧭 GPS daily import starting for ${dataDate} (UTC)`);

  // Load terminals from DB
  const terminals = await db.getAllTerminals();
  const terminalIds = (terminals || [])
    .map((t) => t.terminalid || t.terminalId)
    .filter(Boolean);

  if (terminalIds.length === 0) {
    console.log("No terminals found; nothing to import.");
    return;
  }

  let totalInserted = 0;
  let totalErrors = 0;

  for (const tid of terminalIds) {
    try {
      const response = await fetchTrackForTerminal(tid, startTime, endTime);
      const points = Array.isArray(response?.data) ? response.data : [];
      if (points.length === 0) {
        console.log(`ℹ️  ${tid}: 0 points`);
        continue;
      }

      const rows = points.map((p) => ({
        terminal_id: tid.toString(),
        data_date: dataDate,
        longitude: Number(p.longitude),
        latitude: Number(p.latitude),
      }));

      const inserted = await db.insertTerminalGpsPoints(rows);
      console.log(`✅ ${tid}: inserted ${inserted.length} points`);
      totalInserted += inserted.length;
    } catch (err) {
      totalErrors += 1;
      const details = err.response?.data || err.message || String(err);
      console.error(`❌ ${tid}: failed to import -`, details);
    }
  }

  console.log(
    `🏁 GPS import done for ${dataDate}. Inserted=${totalInserted}, Errors=${totalErrors}`
  );
}

run().catch((e) => {
  console.error("Fatal error in GPS daily import:", e?.message || e);
  process.exit(1);
});
