const express = require("express");
const router = express.Router();
const { supabase } = require("../config/supabase");
const driverAssignment = require("../services/driverAssignment");
const driverAnalytics = require("../services/driverAnalytics");
const { registerDriver } = require("../services/driverRegistration");

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
    const result = await registerDriver(req.body);

    if (!result.success) {
      const response = { error: result.error };
      if (result.details) response.details = result.details;
      if (result.driverId) response.driverId = result.driverId;
      if (result.driverStatus) response.status = result.driverStatus;
      return res.status(result.status).json(response);
    }

    return res.status(result.status).json({
      success: true,
      message: result.message,
      driver: result.driver,
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

// ==========================================================
// Driver Assignment Endpoints
// ==========================================================

/**
 * POST /drivers/:id/assign
 * Assign a driver to a terminal
 * Body: { "terminalId": "string", "notes": "optional string" }
 */
router.post("/:id/assign", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const { terminalId, notes } = req.body;

    if (!terminalId) {
      return res.status(400).json({
        error: "Missing required field: terminalId",
      });
    }

    // Optional: Get user ID from auth middleware if available
    const assignedBy = req.user?.id || null;

    const assignment = await driverAssignment.assignDriver(
      terminalId,
      driverId,
      assignedBy,
      notes
    );

    return res.status(201).json({
      success: true,
      message: `Driver ${driverId} assigned to terminal ${terminalId}`,
      assignment,
    });
  } catch (err) {
    console.error("❌ Error assigning driver:", err);
    return res.status(500).json({
      error: "Failed to assign driver",
      details: err.message,
    });
  }
});

/**
 * POST /drivers/:id/unassign
 * Unassign a driver from their current terminal
 * Body: { "terminalId": "string" }
 */
router.post("/:id/unassign", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const { terminalId } = req.body;

    if (!terminalId) {
      return res.status(400).json({
        error: "Missing required field: terminalId",
      });
    }

    // Verify this driver is assigned to this terminal
    const currentAssignment = await driverAssignment.getCurrentAssignment(
      terminalId
    );

    if (!currentAssignment || currentAssignment.driver_id !== driverId) {
      return res.status(400).json({
        error: "Driver is not currently assigned to this terminal",
      });
    }

    const unassignedBy = req.user?.id || null;

    const result = await driverAssignment.unassignDriver(
      terminalId,
      unassignedBy
    );

    return res.json({
      success: true,
      message: `Driver ${driverId} unassigned from terminal ${terminalId}`,
      assignment: result,
    });
  } catch (err) {
    console.error("❌ Error unassigning driver:", err);
    return res.status(500).json({
      error: "Failed to unassign driver",
      details: err.message,
    });
  }
});

/**
 * GET /drivers/:id/current-assignment
 * Get the current terminal assignment for a driver
 */
router.get("/:id/current-assignment", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);

    // Get all active assignments for this driver
    const { data, error } = await supabase
      .from("terminal_driver_assignments")
      .select("*, terminals(terminalid, name, group_name)")
      .eq("driver_id", driverId)
      .is("unassigned_at", null)
      .order("assigned_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch current assignment: ${error.message}`);
    }

    return res.json({
      success: true,
      assignments: data || [],
      count: data?.length || 0,
    });
  } catch (err) {
    console.error("❌ Error fetching current assignment:", err);
    return res.status(500).json({
      error: "Failed to fetch current assignment",
      details: err.message,
    });
  }
});

/**
 * GET /drivers/:id/assignments
 * Get assignment history for a driver
 * Query params: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
router.get("/:id/assignments", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const { startDate, endDate } = req.query;

    const assignments = await driverAssignment.getDriverAssignments(
      driverId,
      startDate,
      endDate
    );

    return res.json({
      success: true,
      count: assignments.length,
      assignments,
    });
  } catch (err) {
    console.error("❌ Error fetching driver assignments:", err);
    return res.status(500).json({
      error: "Failed to fetch driver assignments",
      details: err.message,
    });
  }
});

// ==========================================================
// Driver Analytics Endpoints
// ==========================================================

/**
 * GET /drivers/:id/analytics
 * Get comprehensive analytics for a driver including zone time breakdown
 * Query params: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (required)
 */
router.get("/:id/analytics", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "Missing required query parameters: startDate and endDate",
        example: "?startDate=2025-11-01&endDate=2025-11-15",
      });
    }

    const analytics = await driverAnalytics.getDriverAnalytics(
      driverId,
      startDate,
      endDate
    );

    return res.json({
      success: true,
      analytics,
    });
  } catch (err) {
    console.error("❌ Error fetching driver analytics:", err);
    return res.status(500).json({
      error: "Failed to fetch driver analytics",
      details: err.message,
    });
  }
});

/**
 * GET /drivers/:id/zone-time
 * Get zone time breakdown for a driver
 * Query params: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (required)
 */
router.get("/:id/zone-time", async (req, res) => {
  try {
    const driverId = parseInt(req.params.id);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "Missing required query parameters: startDate and endDate",
        example: "?startDate=2025-11-01&endDate=2025-11-15",
      });
    }

    const zoneBreakdown = await driverAnalytics.getDriverZoneTimeBreakdown(
      driverId,
      startDate,
      endDate
    );

    return res.json({
      success: true,
      period: { startDate, endDate },
      zones: zoneBreakdown,
      total_zones: zoneBreakdown.length,
    });
  } catch (err) {
    console.error("❌ Error fetching zone time breakdown:", err);
    return res.status(500).json({
      error: "Failed to fetch zone time breakdown",
      details: err.message,
    });
  }
});

/**
 * GET /drivers/analytics/all
 * Get comparative analytics for all drivers
 * Query params: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (required)
 */
router.get("/analytics/all", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "Missing required query parameters: startDate and endDate",
        example: "?startDate=2025-11-01&endDate=2025-11-15",
      });
    }

    const allAnalytics = await driverAnalytics.getAllDriversAnalytics(
      startDate,
      endDate
    );

    return res.json({
      success: true,
      period: { startDate, endDate },
      drivers: allAnalytics,
      total_drivers: allAnalytics.length,
    });
  } catch (err) {
    console.error("❌ Error fetching all drivers analytics:", err);
    return res.status(500).json({
      error: "Failed to fetch all drivers analytics",
      details: err.message,
    });
  }
});

// ==========================================================
// Terminal Assignment Endpoints
// ==========================================================

/**
 * GET /drivers/assignments/active
 * Get all currently active assignments across all drivers
 */
router.get("/assignments/active", async (req, res) => {
  try {
    const assignments = await driverAssignment.getAllActiveAssignments();

    return res.json({
      success: true,
      count: assignments.length,
      assignments,
    });
  } catch (err) {
    console.error("❌ Error fetching active assignments:", err);
    return res.status(500).json({
      error: "Failed to fetch active assignments",
      details: err.message,
    });
  }
});

module.exports = router;
