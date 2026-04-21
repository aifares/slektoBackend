const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");
const { broadcastToDrivers, sendSMS } = require("../services/twilioService");
const { getAllDriversPay } = require("../services/driverPayService");

// All routes here require the existing authMiddleware (applied in server.js)
// and additionally verify the caller is an admin.
function requireAdmin(req, res, next) {
  if (req.client?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}

router.use(requireAdmin);

// =============================================================
// Notifications
// =============================================================

/**
 * POST /admin/drivers/notify
 * Send a notification to one driver, a list of drivers, or all approved drivers.
 *
 * Body:
 * {
 *   "title": "string",
 *   "body": "string",
 *   "sent_via": "in_app" | "sms" | "both",   (default: "in_app")
 *   "driver_ids": [1, 2, 3]                   (omit to broadcast to all)
 * }
 */
router.post("/notify", async (req, res) => {
  try {
    const { title, body, sent_via = "in_app", driver_ids } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: "title and body are required" });
    }

    const validChannels = ["in_app", "sms", "both"];
    if (!validChannels.includes(sent_via)) {
      return res.status(400).json({ error: `sent_via must be one of: ${validChannels.join(", ")}` });
    }

    // Insert in-app notifications
    let smsResult = null;
    if (sent_via === "in_app" || sent_via === "both") {
      if (driver_ids && driver_ids.length > 0) {
        // Targeted: one row per driver
        const rows = driver_ids.map((id) => ({
          driver_id: id,
          title,
          body,
          sent_via,
          sent_at: new Date().toISOString(),
        }));
        const { error } = await supabase.from("driver_notifications").insert(rows);
        if (error) throw new Error(`Failed to insert notifications: ${error.message}`);
      } else {
        // Broadcast: single row with driver_id = NULL
        const { error } = await supabase.from("driver_notifications").insert({
          driver_id: null,
          title,
          body,
          sent_via,
          sent_at: new Date().toISOString(),
        });
        if (error) throw new Error(`Failed to insert broadcast notification: ${error.message}`);
      }
    }

    // Send SMS via Twilio
    if (sent_via === "sms" || sent_via === "both") {
      smsResult = await broadcastToDrivers(`${title}: ${body}`, driver_ids || null);
    }

    console.log(`✅ Admin notification sent — channel: ${sent_via}, targets: ${driver_ids?.length || "all"}`);

    return res.json({
      success: true,
      message: "Notification sent",
      sms: smsResult,
    });
  } catch (err) {
    console.error("❌ Error sending notification:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// =============================================================
// Events
// =============================================================

/**
 * GET /admin/drivers/events
 * List events. Defaults to upcoming only; pass ?include_past=true for all.
 */
router.get("/events", async (req, res) => {
  try {
    const { include_past } = req.query;

    let query = supabase
      .from("driver_events")
      .select("*, drivers(name)")
      .order("event_date", { ascending: true });

    if (include_past !== "true") {
      query = query.gte("event_date", new Date().toISOString());
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return res.json({ success: true, count: data.length, events: data });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * POST /admin/drivers/events
 * Create a new driver event.
 *
 * Body:
 * {
 *   "title": "string",
 *   "description": "string",
 *   "event_date": "ISO 8601",
 *   "location": "string",
 *   "driver_id": 1    (omit for all-driver event)
 * }
 */
router.post("/events", async (req, res) => {
  try {
    const { title, description, event_date, location, driver_id } = req.body;

    if (!title || !event_date) {
      return res.status(400).json({ error: "title and event_date are required" });
    }

    const { data, error } = await supabase
      .from("driver_events")
      .insert({
        title,
        description: description || null,
        event_date,
        location: location || null,
        driver_id: driver_id || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    console.log(`✅ Event created: "${title}" on ${event_date}`);
    return res.status(201).json({ success: true, event: data });
  } catch (err) {
    console.error("❌ Error creating event:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * PATCH /admin/drivers/events/:id
 * Update an event.
 */
router.patch("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ["title", "description", "event_date", "location", "driver_id"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("driver_events")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return res.status(404).json({ error: "Event not found" });
      throw new Error(error.message);
    }

    return res.json({ success: true, event: data });
  } catch (err) {
    console.error("❌ Error updating event:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * DELETE /admin/drivers/events/:id
 * Delete an event.
 */
router.delete("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("driver_events")
      .delete()
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") return res.status(404).json({ error: "Event not found" });
      throw new Error(error.message);
    }

    return res.json({ success: true, message: "Event deleted", event: data });
  } catch (err) {
    console.error("❌ Error deleting event:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// =============================================================
// Pay (admin view)
// =============================================================

/**
 * GET /admin/drivers/pay
 * Pay summary for all drivers.
 */
router.get("/pay", async (req, res) => {
  try {
    const summaries = await getAllDriversPay();
    return res.json({ success: true, count: summaries.length, drivers: summaries });
  } catch (err) {
    console.error("❌ Error fetching all driver pay:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * PATCH /admin/drivers/:id/pay/:period/mark-paid
 * Mark a driver's pay period as paid.
 * :period format: "YYYY-MM"
 *
 * Body (optional):
 * {
 *   "notes": "Paid via bank transfer"
 * }
 */
router.patch("/:id/pay/:period/mark-paid", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id, 10);
    const period = req.params.period;
    const { notes } = req.body;

    if (isNaN(driverId)) return res.status(400).json({ error: "Invalid driver ID" });
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: "period must be in YYYY-MM format" });

    // Verify driver exists
    const { data: driver, error: driverError } = await supabase
      .from("drivers")
      .select("id, name")
      .eq("id", driverId)
      .single();
    if (driverError || !driver) return res.status(404).json({ error: "Driver not found" });

    // Calculate total_hours and total_pay for this period from assignments
    const periodStart = new Date(`${period}-01T00:00:00Z`);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const { data: assignments, error: assignError } = await supabase
      .from("terminal_driver_assignments")
      .select("assigned_at, unassigned_at")
      .eq("driver_id", driverId)
      .not("unassigned_at", "is", null)
      .gte("assigned_at", periodStart.toISOString())
      .lt("assigned_at", periodEnd.toISOString());

    if (assignError) throw new Error(assignError.message);

    const HOURLY_RATE = parseFloat(process.env.DRIVER_HOURLY_RATE || "3.00");
    let totalHours = 0;
    for (const a of assignments || []) {
      totalHours += Math.max(0, (new Date(a.unassigned_at) - new Date(a.assigned_at)) / 1000 / 3600);
    }
    totalHours = parseFloat(totalHours.toFixed(2));
    const totalPay = parseFloat((totalHours * HOURLY_RATE).toFixed(2));

    // Upsert pay period record
    const { data: payPeriod, error: upsertError } = await supabase
      .from("driver_pay_periods")
      .upsert(
        {
          driver_id: driverId,
          period,
          total_hours: totalHours,
          total_pay: totalPay,
          paid_at: new Date().toISOString(),
          paid_by: req.user.id,
          notes: notes || null,
        },
        { onConflict: "driver_id,period" }
      )
      .select()
      .single();

    if (upsertError) throw new Error(upsertError.message);

    console.log(`✅ Marked period ${period} as paid for driver ${driverId} ($${totalPay})`);

    return res.json({
      success: true,
      message: `Pay period ${period} marked as paid for ${driver.name}`,
      pay_period: payPeriod,
    });
  } catch (err) {
    console.error("❌ Error marking pay period as paid:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

/**
 * DELETE /admin/drivers/:id/pay/:period/mark-paid
 * Unmark a pay period (revert to unpaid).
 */
router.delete("/:id/pay/:period/mark-paid", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id, 10);
    const period = req.params.period;

    if (isNaN(driverId)) return res.status(400).json({ error: "Invalid driver ID" });
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: "period must be in YYYY-MM format" });

    const { error } = await supabase
      .from("driver_pay_periods")
      .delete()
      .eq("driver_id", driverId)
      .eq("period", period);

    if (error) throw new Error(error.message);

    return res.json({ success: true, message: `Pay period ${period} unmarked as paid` });
  } catch (err) {
    console.error("❌ Error unmarking pay period:", err);
    return res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

module.exports = router;
