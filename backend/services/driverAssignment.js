const { supabase } = require("../config/supabase");

/**
 * Assign a driver to a terminal
 * @param {string} terminalId - Terminal ID
 * @param {number} driverId - Driver ID
 * @param {string} assignedBy - UUID of user making the assignment
 * @param {string} notes - Optional notes about the assignment
 * @returns {Promise<object>} - The created assignment record
 */
async function assignDriver(terminalId, driverId, assignedBy = null, notes = null) {
  try {
    // First, check if there's already an active assignment for this terminal
    const currentAssignment = await getCurrentAssignment(terminalId);
    
    if (currentAssignment) {
      // If it's the same driver, don't create a new assignment
      if (currentAssignment.driver_id === driverId) {
        console.log(
          `ℹ️ Driver ${driverId} is already assigned to terminal ${terminalId}`
        );
        return currentAssignment;
      }
      
      // Close the existing assignment
      console.log(
        `🔄 Closing existing assignment for terminal ${terminalId} (driver ${currentAssignment.driver_id})`
      );
      await unassignDriver(terminalId, assignedBy);
    }

    // Create new assignment
    const { data, error } = await supabase
      .from("terminal_driver_assignments")
      .insert({
        terminal_id: terminalId,
        driver_id: driverId,
        assigned_at: new Date().toISOString(),
        assigned_by: assignedBy,
        notes: notes,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to assign driver: ${error.message}`);
    }

    console.log(
      `✅ Assigned driver ${driverId} to terminal ${terminalId} (assignment_id: ${data.id})`
    );
    
    return data;
  } catch (error) {
    console.error(`Error assigning driver:`, error.message);
    throw error;
  }
}

/**
 * Unassign the current driver from a terminal
 * @param {string} terminalId - Terminal ID
 * @param {string} unassignedBy - UUID of user making the unassignment
 * @returns {Promise<object|null>} - The updated assignment record or null if no active assignment
 */
async function unassignDriver(terminalId, unassignedBy = null) {
  try {
    const currentAssignment = await getCurrentAssignment(terminalId);
    
    if (!currentAssignment) {
      console.log(`ℹ️ No active assignment found for terminal ${terminalId}`);
      return null;
    }

    const now = new Date().toISOString();
    
    const { data, error } = await supabase
      .from("terminal_driver_assignments")
      .update({
        unassigned_at: now,
        unassigned_by: unassignedBy,
      })
      .eq("id", currentAssignment.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to unassign driver: ${error.message}`);
    }

    console.log(
      `✅ Unassigned driver ${currentAssignment.driver_id} from terminal ${terminalId}`
    );
    
    return data;
  } catch (error) {
    console.error(`Error unassigning driver:`, error.message);
    throw error;
  }
}

/**
 * Get the current active assignment for a terminal
 * @param {string} terminalId - Terminal ID
 * @returns {Promise<object|null>} - The active assignment or null
 */
async function getCurrentAssignment(terminalId) {
  try {
    const { data, error } = await supabase
      .from("terminal_driver_assignments")
      .select("*, drivers(id, name, phone, email)")
      .eq("terminal_id", terminalId)
      .is("unassigned_at", null)
      .order("assigned_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error(`Failed to get current assignment: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error(
      `Error getting current assignment for ${terminalId}:`,
      error.message
    );
    return null;
  }
}

/**
 * Get the current driver for a terminal (returns just the driver info)
 * @param {string} terminalId - Terminal ID
 * @returns {Promise<object|null>} - The driver info or null
 */
async function getCurrentDriverForTerminal(terminalId) {
  try {
    const assignment = await getCurrentAssignment(terminalId);
    return assignment ? assignment.drivers : null;
  } catch (error) {
    console.error(
      `Error getting current driver for ${terminalId}:`,
      error.message
    );
    return null;
  }
}

/**
 * Get all assignments for a driver within a date range
 * @param {number} driverId - Driver ID
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {Promise<Array>} - Array of assignment records
 */
async function getDriverAssignments(driverId, startDate = null, endDate = null) {
  try {
    let query = supabase
      .from("terminal_driver_assignments")
      .select("*, terminals(terminalid, name, group_name)")
      .eq("driver_id", driverId)
      .order("assigned_at", { ascending: false });

    if (startDate) {
      query = query.gte("assigned_at", startDate);
    }
    
    if (endDate) {
      query = query.lte("assigned_at", endDate);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get driver assignments: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error(`Error getting assignments for driver ${driverId}:`, error.message);
    throw error;
  }
}

/**
 * Get assignment history for a terminal
 * @param {string} terminalId - Terminal ID
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<Array>} - Array of assignment records
 */
async function getTerminalAssignmentHistory(terminalId, limit = 50) {
  try {
    const { data, error } = await supabase
      .from("terminal_driver_assignments")
      .select("*, drivers(id, name, phone, email)")
      .eq("terminal_id", terminalId)
      .order("assigned_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to get terminal assignment history: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error(
      `Error getting assignment history for terminal ${terminalId}:`,
      error.message
    );
    throw error;
  }
}

/**
 * Get all currently active assignments
 * @returns {Promise<Array>} - Array of active assignment records
 */
async function getAllActiveAssignments() {
  try {
    const { data, error } = await supabase
      .from("terminal_driver_assignments")
      .select("*, drivers(id, name, phone, email), terminals(terminalid, name, group_name)")
      .is("unassigned_at", null)
      .order("assigned_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to get active assignments: ${error.message}`);
    }

    return data || [];
  } catch (error) {
    console.error(`Error getting active assignments:`, error.message);
    throw error;
  }
}

module.exports = {
  assignDriver,
  unassignDriver,
  getCurrentAssignment,
  getCurrentDriverForTerminal,
  getDriverAssignments,
  getTerminalAssignmentHistory,
  getAllActiveAssignments,
};

