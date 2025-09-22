const express = require("express");
const router = express.Router();

const databaseService = require("../services/database");
const { supabase } = require("../config/supabase");

// --- Get currently playing content ---
router.get("/:terminalId/current", async (req, res) => {
  const { terminalId } = req.params;

  try {
    const currentlyPlaying = await databaseService.getCurrentlyPlaying(
      terminalId
    );

    if (!currentlyPlaying) {
      return res.status(404).json({
        message: "No content currently playing on this terminal",
        terminalId,
      });
    }

    // Get program files from media API if program_id exists
    let programFiles = [];
    if (currentlyPlaying.program_id) {
      try {
        programFiles = await databaseService.fetchMediaByProgramId(
          currentlyPlaying.program_id
        );
      } catch (mediaErr) {
        console.warn(
          `Error fetching media files for program ${currentlyPlaying.program_id}: ${mediaErr.message}`
        );
      }
    }

    res.json({
      terminalId,
      currentlyPlaying,
      programFiles,
    });
  } catch (err) {
    console.error("Error fetching currently playing:", err.message);
    res.status(500).json({
      error: "Failed to fetch currently playing content",
      details: err.message,
    });
  }
});

// --- Get recently played content ---
router.get("/:terminalId/recent", async (req, res) => {
  const { terminalId } = req.params;
  const { limit = 10 } = req.query;

  try {
    const recentlyPlayed = await databaseService.getRecentlyPlayed(
      terminalId,
      parseInt(limit)
    );

    // Add program files for each recently played item
    const recentlyPlayedWithFiles = await Promise.all(
      recentlyPlayed.map(async (item) => {
        let programFiles = [];
        if (item.program_id) {
          try {
            programFiles = await databaseService.fetchMediaByProgramId(
              item.program_id
            );
          } catch (mediaErr) {
            console.warn(
              `Error fetching media files for ${item.program_name}: ${mediaErr.message}`
            );
          }
        }

        return {
          ...item,
          programFiles,
        };
      })
    );

    res.json({
      terminalId,
      limit: parseInt(limit),
      count: recentlyPlayedWithFiles.length,
      recentlyPlayed: recentlyPlayedWithFiles,
    });
  } catch (err) {
    console.error("Error fetching recently played:", err.message);
    res.status(500).json({
      error: "Failed to fetch recently played content",
      details: err.message,
    });
  }
});

// --- Get full playback history (current + recent) ---
router.get("/:terminalId/history", async (req, res) => {
  const { terminalId } = req.params;
  const { recentLimit = 10 } = req.query;

  try {
    const playbackHistory = await databaseService.getPlaybackHistory(
      terminalId,
      parseInt(recentLimit)
    );

    // Add program files for current playing if exists
    let currentWithFiles = null;
    if (playbackHistory.current) {
      let programFiles = [];
      if (playbackHistory.current.program_id) {
        try {
          programFiles = await databaseService.fetchMediaByProgramId(
            playbackHistory.current.program_id
          );
        } catch (mediaErr) {
          console.warn(
            `Error fetching media files for current: ${mediaErr.message}`
          );
        }
      }

      currentWithFiles = {
        ...playbackHistory.current,
        programFiles,
      };
    }

    // Add program files for recent items
    const recentWithFiles = await Promise.all(
      (playbackHistory.recent || []).map(async (item) => {
        let programFiles = [];
        if (item.program_id) {
          try {
            programFiles = await databaseService.fetchMediaByProgramId(
              item.program_id
            );
          } catch (mediaErr) {
            console.warn(
              `Error fetching media files for ${item.program_name}: ${mediaErr.message}`
            );
          }
        }

        return {
          ...item,
          programFiles,
        };
      })
    );

    res.json({
      terminalId,
      recentLimit: parseInt(recentLimit),
      current: currentWithFiles,
      recent: recentWithFiles,
      totalRecent: recentWithFiles.length,
    });
  } catch (err) {
    console.error("Error fetching playback history:", err.message);
    res.status(500).json({
      error: "Failed to fetch playback history",
      details: err.message,
    });
  }
});

// --- Get duration analytics for a specific program/date ---
router.get("/:terminalId/duration", async (req, res) => {
  const { terminalId } = req.params;
  const {
    program,
    date = new Date().toISOString().split("T")[0],
    startDate,
    endDate,
  } = req.query;

  try {
    let query = supabase
      .from("playing")
      .select("program_name, file_name, duration_seconds, started_at, ended_at")
      .eq("terminal_id", terminalId)
      .eq("status", "completed");

    // Filter by program if specified
    if (program) {
      query = query.eq("program_name", program);
    }

    // Filter by date range
    if (startDate && endDate) {
      query = query
        .gte("started_at", `${startDate}T00:00:00`)
        .lt("started_at", `${endDate}T23:59:59`);
    } else {
      query = query
        .gte("started_at", `${date}T00:00:00`)
        .lt("started_at", `${date}T23:59:59`);
    }

    const { data, error } = await query;

    if (error)
      throw new Error(`Failed to fetch duration data: ${error.message}`);

    const totalDuration = data.reduce(
      (sum, record) => sum + (record.duration_seconds || 0),
      0
    );
    const avgDuration =
      data.length > 0 ? Math.round(totalDuration / data.length) : 0;

    res.json({
      terminalId,
      program: program || "all",
      date,
      startDate,
      endDate,
      totalDuration: {
        seconds: totalDuration,
        minutes: Math.round((totalDuration / 60) * 100) / 100,
        hours: Math.round((totalDuration / 3600) * 100) / 100,
      },
      sessions: data.length,
      avgSessionDuration: {
        seconds: avgDuration,
        minutes: Math.round((avgDuration / 60) * 100) / 100,
      },
      details: data,
    });
  } catch (err) {
    console.error("Error fetching duration analytics:", err.message);
    res.status(500).json({
      error: "Failed to fetch duration analytics",
      details: err.message,
    });
  }
});

// --- Get program analytics summary ---
router.get("/analytics/programs", async (req, res) => {
  const {
    terminalId,
    date = new Date().toISOString().split("T")[0],
    startDate,
    endDate,
  } = req.query;

  try {
    let query = supabase
      .from("playing")
      .select("terminal_id, program_name, duration_seconds, started_at")
      .eq("status", "completed");

    // Filter by terminal if specified
    if (terminalId) {
      query = query.eq("terminal_id", terminalId);
    }

    // Filter by date range
    if (startDate && endDate) {
      query = query
        .gte("started_at", `${startDate}T00:00:00`)
        .lt("started_at", `${endDate}T23:59:59`);
    } else {
      query = query
        .gte("started_at", `${date}T00:00:00`)
        .lt("started_at", `${date}T23:59:59`);
    }

    const { data, error } = await query;

    if (error)
      throw new Error(`Failed to fetch program analytics: ${error.message}`);

    // Group by program and calculate analytics
    const programStats = {};

    data.forEach((record) => {
      const programName = record.program_name || "Unknown";
      if (!programStats[programName]) {
        programStats[programName] = {
          program_name: programName,
          total_duration_seconds: 0,
          session_count: 0,
          terminals: new Set(),
        };
      }

      programStats[programName].total_duration_seconds +=
        record.duration_seconds || 0;
      programStats[programName].session_count += 1;
      programStats[programName].terminals.add(record.terminal_id);
    });

    // Convert to array and add calculated fields
    const programSummary = Object.values(programStats).map((stat) => ({
      program_name: stat.program_name,
      total_duration: {
        seconds: stat.total_duration_seconds,
        minutes: Math.round((stat.total_duration_seconds / 60) * 100) / 100,
        hours: Math.round((stat.total_duration_seconds / 3600) * 100) / 100,
      },
      session_count: stat.session_count,
      avg_session_duration: {
        seconds: Math.round(stat.total_duration_seconds / stat.session_count),
        minutes:
          Math.round(
            (stat.total_duration_seconds / stat.session_count / 60) * 100
          ) / 100,
      },
      terminal_count: stat.terminals.size,
      terminals: Array.from(stat.terminals),
    }));

    // Sort by total duration (most played first)
    programSummary.sort(
      (a, b) => b.total_duration.seconds - a.total_duration.seconds
    );

    res.json({
      date,
      startDate,
      endDate,
      terminalId: terminalId || "all",
      total_programs: programSummary.length,
      programs: programSummary,
    });
  } catch (err) {
    console.error("Error fetching program analytics:", err.message);
    res.status(500).json({
      error: "Failed to fetch program analytics",
      details: err.message,
    });
  }
});

module.exports = router;
