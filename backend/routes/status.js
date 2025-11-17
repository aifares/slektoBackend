const express = require("express");
const router = express.Router();

const databaseService = require("../services/database");
const { supabase } = require("../config/supabase");
const driverAssignment = require("../services/driverAssignment");

// --- Get current status of all terminals ---
router.get("/terminals", async (req, res) => {
  try {
    const axios = require("axios");
    const { COLORLIGHT_BASE_URL, AUTH_HEADER } = require("../utils");
    const includeDrivers = req.query.includeDrivers === "true";

    // Get fresh terminal data from ColorLight API
    const response = await axios.get(`${COLORLIGHT_BASE_URL}`, AUTH_HEADER);
    const rawTerminals = response.data;

    // Get current status for each terminal using fresh API data
    const terminalsWithStatus = await Promise.all(
      rawTerminals.map(async (terminalData) => {
        const terminalId = terminalData.id;
        const currentStatus = await databaseService.getCurrentTerminalStatus(
          terminalId
        );
        const { isOnline, reason, indicators } =
          databaseService.determineOnlineStatus(terminalData);

        const terminalInfo = {
          terminalid: terminalId,
          name:
            terminalData.title?.rendered ||
            terminalData.title?.raw ||
            `Terminal ${terminalId}`,
          last_report_time: terminalData.post_meta?._led_status?.rtc
            ?._report_time
            ? new Date(
                terminalData.post_meta._led_status.rtc._report_time * 1000
              ).toISOString()
            : null,
          power_status:
            terminalData.post_meta?._led_status?.powerstatus?.powerstatus?.toString() ||
            null,
          led_latest_time:
            terminalData.post_meta?._led_latest_report_time || null,
          current_status: {
            is_online: isOnline,
            status: isOnline ? "online" : "offline",
            reason,
            indicators,
            last_status_change: currentStatus?.status_changed_at || null,
            duration_seconds: currentStatus?.duration_seconds || null,
          },
        };

        // Optionally include driver assignment info
        if (includeDrivers) {
          try {
            const assignment = await driverAssignment.getCurrentAssignment(
              terminalId
            );
            if (assignment) {
              const assignedDuration = Math.floor(
                (Date.now() - new Date(assignment.assigned_at).getTime()) / 1000
              );
              terminalInfo.driver_assignment = {
                driver: assignment.drivers,
                assigned_at: assignment.assigned_at,
                assigned_duration_seconds: assignedDuration,
                assigned_duration_hours:
                  Math.round((assignedDuration / 3600) * 100) / 100,
                notes: assignment.notes,
              };
            } else {
              terminalInfo.driver_assignment = null;
            }
          } catch (driverError) {
            console.warn(
              `Failed to fetch driver for terminal ${terminalId}:`,
              driverError.message
            );
            terminalInfo.driver_assignment = null;
          }
        }

        return terminalInfo;
      })
    );

    res.json({
      terminals: terminalsWithStatus,
      total_terminals: terminalsWithStatus.length,
      online_count: terminalsWithStatus.filter(
        (t) => t.current_status.is_online
      ).length,
      offline_count: terminalsWithStatus.filter(
        (t) => !t.current_status.is_online
      ).length,
      terminals_with_drivers: includeDrivers
        ? terminalsWithStatus.filter((t) => t.driver_assignment !== null).length
        : undefined,
    });
  } catch (err) {
    console.error("Error fetching terminal status:", err.message);
    res.status(500).json({
      error: "Failed to fetch terminal status",
      details: err.message,
    });
  }
});

// --- Get current status of a specific terminal ---
router.get("/terminals/:terminalId", async (req, res) => {
  const { terminalId } = req.params;

  try {
    const { data: terminal, error } = await supabase
      .from("terminals")
      .select(
        "terminalid, name, last_report_time, power_status, led_latest_time"
      )
      .eq("terminalid", terminalId)
      .single();

    if (error) throw new Error(`Failed to fetch terminal: ${error.message}`);

    const currentStatus = await databaseService.getCurrentTerminalStatus(
      terminalId
    );
    const { isOnline, reason, indicators } =
      databaseService.determineOnlineStatus(terminal);

    res.json({
      terminal: {
        ...terminal,
        current_status: {
          is_online: isOnline,
          status: isOnline ? "online" : "offline",
          reason,
          indicators,
          last_status_change: currentStatus?.status_changed_at || null,
          duration_seconds: currentStatus?.duration_seconds || null,
        },
      },
    });
  } catch (err) {
    console.error(`Error fetching terminal ${terminalId} status:`, err.message);
    res.status(500).json({
      error: "Failed to fetch terminal status",
      details: err.message,
    });
  }
});

// --- Get terminal uptime analytics ---
router.get("/analytics/uptime", async (req, res) => {
  const {
    terminalId,
    startDate = new Date().toISOString().split("T")[0],
    endDate = new Date().toISOString().split("T")[0],
  } = req.query;

  try {
    const analytics = await databaseService.getTerminalUptimeAnalytics(
      terminalId || null,
      startDate,
      endDate
    );

    res.json(analytics);
  } catch (err) {
    console.error("Error fetching uptime analytics:", err.message);
    res.status(500).json({
      error: "Failed to fetch uptime analytics",
      details: err.message,
    });
  }
});

// --- Get terminal status history ---
router.get("/terminals/:terminalId/history", async (req, res) => {
  const { terminalId } = req.params;
  const {
    startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    endDate = new Date().toISOString().split("T")[0],
    limit = 100,
  } = req.query;

  try {
    const { data: statusHistory, error } = await supabase
      .from("terminal_status_log")
      .select("*")
      .eq("terminal_id", terminalId)
      .gte("status_changed_at", `${startDate}T00:00:00`)
      .lt("status_changed_at", `${endDate}T23:59:59`)
      .order("status_changed_at", { ascending: false })
      .limit(parseInt(limit));

    if (error)
      throw new Error(`Failed to fetch status history: ${error.message}`);

    res.json({
      terminalId,
      period: { startDate, endDate },
      statusHistory,
      total_records: statusHistory.length,
    });
  } catch (err) {
    console.error(
      `Error fetching status history for ${terminalId}:`,
      err.message
    );
    res.status(500).json({
      error: "Failed to fetch status history",
      details: err.message,
    });
  }
});

// --- Get terminal reliability report ---
router.get("/analytics/reliability", async (req, res) => {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    endDate = new Date().toISOString().split("T")[0],
  } = req.query;

  try {
    const analytics = await databaseService.getTerminalUptimeAnalytics(
      null, // All terminals
      startDate,
      endDate
    );

    // Calculate reliability metrics
    const reliabilityReport = analytics.terminals.map((terminal) => ({
      terminal_id: terminal.terminal_id,
      uptime_percentage: terminal.uptime_percentage,
      total_online_hours: terminal.total_online_hours,
      total_offline_hours: terminal.total_offline_hours,
      online_sessions: terminal.online_sessions,
      offline_sessions: terminal.offline_sessions,
      reliability_score:
        terminal.uptime_percentage >= 95
          ? "excellent"
          : terminal.uptime_percentage >= 90
          ? "good"
          : terminal.uptime_percentage >= 80
          ? "fair"
          : "poor",
      avg_session_duration_hours:
        terminal.online_sessions > 0
          ? Math.round(
              (terminal.total_online_hours / terminal.online_sessions) * 100
            ) / 100
          : 0,
    }));

    // Sort by uptime percentage (most reliable first)
    reliabilityReport.sort((a, b) => b.uptime_percentage - a.uptime_percentage);

    res.json({
      period: { startDate, endDate },
      total_terminals: reliabilityReport.length,
      terminals: reliabilityReport,
      summary: {
        excellent: reliabilityReport.filter(
          (t) => t.reliability_score === "excellent"
        ).length,
        good: reliabilityReport.filter((t) => t.reliability_score === "good")
          .length,
        fair: reliabilityReport.filter((t) => t.reliability_score === "fair")
          .length,
        poor: reliabilityReport.filter((t) => t.reliability_score === "poor")
          .length,
        avg_uptime:
          Math.round(
            (reliabilityReport.reduce(
              (sum, t) => sum + t.uptime_percentage,
              0
            ) /
              reliabilityReport.length) *
              100
          ) / 100,
      },
    });
  } catch (err) {
    console.error("Error fetching reliability report:", err.message);
    res.status(500).json({
      error: "Failed to fetch reliability report",
      details: err.message,
    });
  }
});

module.exports = router;
