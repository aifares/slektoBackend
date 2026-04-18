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
 * List all events (including past).
 */
router.get("/events", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("driver_events")
      .select("*, drivers(name)")
      .order("event_date", { ascending: false });

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

module.exports = router;
