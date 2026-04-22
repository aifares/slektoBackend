const express = require("express");
const router = express.Router();
const { syncMediaFromColorLight } = require("../services/mediaSync");
const { supabase } = require("../config/supabase");

/**
 * Admin Routes
 * 
 * Administrative endpoints for system management
 * All routes require authentication (bearer token)
 */

/**
 * Manually trigger media sync from ColorLight
 * This does not wait for the scheduled 2am sync
 * 
 * POST /admin/sync-media
 * Authorization: Bearer <token>
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Media sync completed",
 *   "results": {
 *     "total_fetched": 125,
 *     "total_processed": 125,
 *     "files_with_client_id": 100,
 *     "files_without_client_id": 25,
 *     "upsert_results": { "inserted": 125, "updated": 0, "failed": 0 },
 *     "duration_ms": 3450
 *   }
 * }
 */
router.post("/sync-media", async (req, res) => {
  try {
    console.log(`\n🔧 Manual media sync triggered by admin`);

    const result = await syncMediaFromColorLight();

    if (result.success) {
      return res.json({
        success: true,
        message: "Media sync completed successfully",
        results: {
          total_fetched: result.total_fetched,
          total_processed: result.total_processed,
          files_with_client_id: result.files_with_client_id,
          files_without_client_id: result.files_without_client_id,
          upsert_results: result.upsert_results,
          pages_processed: result.pages_processed,
          duration_ms: result.duration_ms,
          started_at: result.started_at,
          completed_at: result.completed_at,
        },
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Media sync completed with errors",
        results: result,
        errors: result.errors,
      });
    }
  } catch (error) {
    console.error("❌ Manual media sync error:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to trigger media sync",
      details: error.message,
    });
  }
});

/**
 * Get media sync status
 * Shows schedule and last sync information from database
 * 
 * GET /admin/sync-media/status
 * Authorization: Bearer <token>
 * 
 * Response:
 * {
 *   "success": true,
 *   "status": {
 *     "schedule": "Daily at 2:00 AM (via cron)",
 *     "next_run": "2025-11-25T02:00:00.000Z",
 *     "last_sync": "2025-11-24T02:00:00.000Z"
 *   }
 * }
 */
router.get("/sync-media/status", async (req, res) => {
  try {
    const { supabase } = require("../config/supabase");

    // Get most recent sync from files table
    const { data, error } = await supabase
      .from("files")
      .select("last_synced_at")
      .not("last_synced_at", "is", null)
      .order("last_synced_at", { ascending: false })
      .limit(1)
      .single();

    // Calculate next 2am
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return res.json({
      success: true,
      status: {
        schedule: "Daily at 2:00 AM (via cron)",
        next_run: next.toISOString(),
        last_sync: data?.last_synced_at || null,
      },
    });
  } catch (error) {
    console.error("❌ Error getting media sync status:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to get media sync status",
      details: error.message,
    });
  }
});

/**
 * GET /admin/debug/playing
 * Shows recent playing records (including null program_id) to diagnose analytics gaps.
 */
router.get("/debug/playing", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("playing")
      .select("id, terminal_id, program_id, program_name, file_name, status, started_at, ended_at")
      .order("started_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    const nullCount = (data || []).filter((r) => !r.program_id).length;
    const byTerminal = {};
    for (const r of data || []) {
      if (!byTerminal[r.terminal_id]) byTerminal[r.terminal_id] = [];
      byTerminal[r.terminal_id].push(r);
    }

    return res.json({
      total: data?.length || 0,
      null_program_id_count: nullCount,
      by_terminal: byTerminal,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

