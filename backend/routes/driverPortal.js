const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");
const { driverAuthMiddleware } = require("../middleware/driverAuth");
const { getDriverPay } = require("../services/driverPayService");

router.use(driverAuthMiddleware);

/**
 * GET /driver-portal/me
 * Driver profile and current assignment status.
 */
router.get("/me", async (req, res) => {
  try {
    const driver = req.driver;

    // Fetch active terminal assignment if any
    const { data: assignment } = await supabase
      .from("terminal_driver_assignments")
      .select("terminal_id, assigned_at, terminals(name, group_name)")
      .eq("driver_id", driver.id)
      .is("unassigned_at", null)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.json({
      success: true,
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
        phone: driver.phone,
        status: driver.status,
        city: driver.city,
        state: driver.state,
        member_since: driver.created_at,
      },
      current_assignment: assignment
        ? {
            terminal_id: assignment.terminal_id,
            terminal_name: assignment.terminals?.name,
            group_name: assignment.terminals?.group_name,
            assigned_since: assignment.assigned_at,
          }
        : null,
    });
  } catch (err) {
    console.error("❌ Error fetching driver profile:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * GET /driver-portal/notifications
 * In-app notifications for this driver (own + broadcasts).
 * Query params: ?unread_only=true&limit=20&offset=0
 */
router.get("/notifications", async (req, res) => {
  try {
    const { unread_only, limit = 20, offset = 0 } = req.query;

    // Fetch notifications targeted to this driver or broadcast (driver_id IS NULL)
    let query = supabase
      .from("driver_notifications")
      .select("*")
      .or(`driver_id.eq.${req.driver.id},driver_id.is.null`)
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (unread_only === "true") {
      query = query.is("read_at", null);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return res.json({
      success: true,
      count: data.length,
      notifications: data,
    });
  } catch (err) {
    console.error("❌ Error fetching notifications:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * PATCH /driver-portal/notifications/:id/read
 * Mark a notification as read.
 */
router.patch("/notifications/:id/read", async (req, res) => {
  try {
    const { id } = req.params;

    // Verify notification belongs to this driver or is a broadcast
    const { data: notif, error: fetchError } = await supabase
      .from("driver_notifications")
      .select("id, driver_id, read_at")
      .eq("id", id)
      .maybeSingle();

    if (fetchError || !notif) {
      return res.status(404).json({ error: "Notification not found" });
    }

    if (notif.driver_id !== null && notif.driver_id !== req.driver.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (notif.read_at) {
      return res.json({ success: true, message: "Already marked as read" });
    }

    const { error: updateError } = await supabase
      .from("driver_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) throw new Error(updateError.message);

    return res.json({ success: true, message: "Marked as read" });
  } catch (err) {
    console.error("❌ Error marking notification read:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * GET /driver-portal/events
 * Upcoming events visible to this driver (own + all-driver events).
 * Query params: ?include_past=true
 */
router.get("/events", async (req, res) => {
  try {
    const { include_past } = req.query;

    let query = supabase
      .from("driver_events")
      .select("*")
      .or(`driver_id.eq.${req.driver.id},driver_id.is.null`)
      .order("event_date", { ascending: true });

    if (include_past !== "true") {
      query = query.gte("event_date", new Date().toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return res.json({
      success: true,
      count: data.length,
      events: data,
    });
  } catch (err) {
    console.error("❌ Error fetching events:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * GET /driver-portal/pay
 * Pay summary: total hours worked, total earnings at $3/hr, shift history.
 */
router.get("/pay", async (req, res) => {
  try {
    const pay = await getDriverPay(req.driver.id);
    return res.json({ success: true, ...pay });
  } catch (err) {
    console.error("❌ Error fetching pay:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

module.exports = router;
