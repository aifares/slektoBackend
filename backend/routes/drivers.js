const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");

/**
 * POST /drivers/register
 * Register a new driver with their application details
 *
 * Expected payload:
 * {
 *   "fullName": "string",
 *   "email": "string",
 *   "phone": "string",
 *   "address": "string",
 *   "city": "string",
 *   "state": "string",
 *   "dateOfBirth": "YYYY-MM-DD",
 *   "driversLicense": "string",
 *   "dailyHours": "number",
 *   "weeklyHours": "number",
 *   "submissionDate": "YYYY-MM-DD",
 *   "submissionTime": "HH:MM:SS",
 *   "ipAddress": "string",
 *   "termsAccepted": boolean,
 *   "termsAcceptedAt": "ISO 8601 timestamp"
 * }
 */
router.post("/register", async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      address,
      city,
      state,
      dateOfBirth,
      driversLicense,
      dailyHours,
      weeklyHours,
      submissionDate,
      submissionTime,
      ipAddress,
      termsAccepted,
      termsAcceptedAt,
    } = req.body;

    // Validate required fields
    if (!fullName) {
      return res.status(400).json({
        error: "Missing required field: fullName",
      });
    }

    if (!termsAccepted) {
      return res.status(400).json({
        error: "Terms must be accepted to register",
      });
    }

    // Check if driver with this email already exists
    if (email) {
      const { data: existingDriver, error: checkError } = await supabase
        .from("drivers")
        .select("id, email, status")
        .eq("email", email)
        .single();

      if (existingDriver) {
        return res.status(409).json({
          error: "Driver with this email already exists",
          driverId: existingDriver.id,
          status: existingDriver.status,
        });
      }
    }

    // Insert new driver
    const { data, error } = await supabase
      .from("drivers")
      .insert([
        {
          name: fullName,
          email: email || null,
          phone: phone || null,
          address: address || null,
          city: city || null,
          state: state || null,
          date_of_birth: dateOfBirth || null,
          license_number: driversLicense || null,
          daily_hours: dailyHours ? parseFloat(dailyHours) : null,
          weekly_hours: weeklyHours ? parseFloat(weeklyHours) : null,
          submission_date: submissionDate || null,
          submission_time: submissionTime || null,
          ip_address: ipAddress || null,
          terms_accepted: termsAccepted,
          terms_accepted_at: termsAcceptedAt || new Date().toISOString(),
          status: "pending",
        },
      ])
      .select();

    if (error) {
      console.error("❌ Error inserting driver:", error);
      return res.status(500).json({
        error: "Failed to register driver",
        details: error.message,
      });
    }

    console.log(
      `✅ Driver registered successfully: ${fullName} (ID: ${data[0].id})`
    );

    return res.status(201).json({
      success: true,
      message: "Driver registration submitted successfully",
      driver: {
        id: data[0].id,
        name: data[0].name,
        email: data[0].email,
        status: data[0].status,
        createdAt: data[0].created_at,
      },
    });
  } catch (err) {
    console.error("❌ Unexpected error in driver registration:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

/**
 * GET /drivers
 * Get all drivers (optionally filtered by status)
 * Query params: ?status=pending|approved|rejected|inactive
 */
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("❌ Error fetching drivers:", error);
      return res.status(500).json({
        error: "Failed to fetch drivers",
        details: error.message,
      });
    }

    return res.json({
      success: true,
      count: data.length,
      drivers: data,
    });
  } catch (err) {
    console.error("❌ Unexpected error fetching drivers:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

/**
 * GET /drivers/:id
 * Get a specific driver by ID
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          error: "Driver not found",
        });
      }
      console.error("❌ Error fetching driver:", error);
      return res.status(500).json({
        error: "Failed to fetch driver",
        details: error.message,
      });
    }

    return res.json({
      success: true,
      driver: data,
    });
  } catch (err) {
    console.error("❌ Unexpected error fetching driver:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

/**
 * PATCH /drivers/:id/status
 * Update driver status (approve, reject, etc.)
 * Body: { "status": "approved" | "rejected" | "inactive" }
 */
router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["pending", "approved", "rejected", "inactive"];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        validStatuses,
      });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({ status })
      .eq("id", id)
      .select();

    if (error) {
      console.error("❌ Error updating driver status:", error);
      return res.status(500).json({
        error: "Failed to update driver status",
        details: error.message,
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        error: "Driver not found",
      });
    }

    console.log(`✅ Driver ${id} status updated to: ${status}`);

    return res.json({
      success: true,
      message: `Driver status updated to ${status}`,
      driver: data[0],
    });
  } catch (err) {
    console.error("❌ Unexpected error updating driver status:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

/**
 * PUT /drivers/:id
 * Update driver details
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};

    // Map request body to database fields
    const fieldMapping = {
      fullName: "name",
      email: "email",
      phone: "phone",
      address: "address",
      city: "city",
      state: "state",
      dateOfBirth: "date_of_birth",
      driversLicense: "license_number",
      dailyHours: "daily_hours",
      weeklyHours: "weekly_hours",
    };

    // Build update object
    Object.keys(fieldMapping).forEach((reqKey) => {
      if (req.body[reqKey] !== undefined) {
        const dbKey = fieldMapping[reqKey];
        if (reqKey === "dailyHours" || reqKey === "weeklyHours") {
          updates[dbKey] = parseFloat(req.body[reqKey]);
        } else {
          updates[dbKey] = req.body[reqKey];
        }
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: "No valid fields to update",
      });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update(updates)
      .eq("id", id)
      .select();

    if (error) {
      console.error("❌ Error updating driver:", error);
      return res.status(500).json({
        error: "Failed to update driver",
        details: error.message,
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        error: "Driver not found",
      });
    }

    console.log(`✅ Driver ${id} updated successfully`);

    return res.json({
      success: true,
      message: "Driver updated successfully",
      driver: data[0],
    });
  } catch (err) {
    console.error("❌ Unexpected error updating driver:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

/**
 * DELETE /drivers/:id
 * Delete a driver
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("drivers")
      .delete()
      .eq("id", id)
      .select();

    if (error) {
      console.error("❌ Error deleting driver:", error);
      return res.status(500).json({
        error: "Failed to delete driver",
        details: error.message,
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        error: "Driver not found",
      });
    }

    console.log(`✅ Driver ${id} deleted successfully`);

    return res.json({
      success: true,
      message: "Driver deleted successfully",
    });
  } catch (err) {
    console.error("❌ Unexpected error deleting driver:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

module.exports = router;
