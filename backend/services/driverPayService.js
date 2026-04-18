const { supabase } = require("../config/supabase");

const HOURLY_RATE = parseFloat(process.env.DRIVER_HOURLY_RATE || "3.00");

/**
 * Calculate total hours worked and pay for a driver.
 * Reads completed shifts from terminal_driver_assignments.
 * Only counts shifts where unassigned_at is set (completed shifts).
 */
async function getDriverPay(driverId) {
  const { data: assignments, error } = await supabase
    .from("terminal_driver_assignments")
    .select("id, terminal_id, assigned_at, unassigned_at, notes, terminals(name)")
    .eq("driver_id", driverId)
    .not("unassigned_at", "is", null)
    .order("assigned_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch assignments: ${error.message}`);

  const shifts = (assignments || []).map((a) => {
    const start = new Date(a.assigned_at);
    const end = new Date(a.unassigned_at);
    const hours = Math.max(0, (end - start) / 1000 / 3600);
    const pay = parseFloat((hours * HOURLY_RATE).toFixed(2));
    return {
      id: a.id,
      terminal_id: a.terminal_id,
      terminal_name: a.terminals?.name || null,
      assigned_at: a.assigned_at,
      unassigned_at: a.unassigned_at,
      hours: parseFloat(hours.toFixed(2)),
      pay,
      notes: a.notes,
    };
  });

  const total_hours = parseFloat(
    shifts.reduce((sum, s) => sum + s.hours, 0).toFixed(2)
  );
  const total_pay = parseFloat((total_hours * HOURLY_RATE).toFixed(2));

  // Check if there is a currently active (open) shift
  const { data: activeShifts } = await supabase
    .from("terminal_driver_assignments")
    .select("id, terminal_id, assigned_at, terminals(name)")
    .eq("driver_id", driverId)
    .is("unassigned_at", null)
    .order("assigned_at", { ascending: false });

  const active_shift =
    activeShifts && activeShifts.length > 0
      ? {
          id: activeShifts[0].id,
          terminal_id: activeShifts[0].terminal_id,
          terminal_name: activeShifts[0].terminals?.name || null,
          assigned_at: activeShifts[0].assigned_at,
          hours_so_far: parseFloat(
            ((Date.now() - new Date(activeShifts[0].assigned_at)) / 1000 / 3600).toFixed(2)
          ),
        }
      : null;

  return {
    driver_id: driverId,
    hourly_rate: HOURLY_RATE,
    total_hours,
    total_pay,
    active_shift,
    shifts,
  };
}

/**
 * Get pay summaries for all drivers (admin view).
 */
async function getAllDriversPay() {
  const { data: assignments, error } = await supabase
    .from("terminal_driver_assignments")
    .select("driver_id, assigned_at, unassigned_at")
    .not("unassigned_at", "is", null);

  if (error) throw new Error(`Failed to fetch assignments: ${error.message}`);

  const byDriver = {};
  for (const a of assignments || []) {
    const hours = Math.max(
      0,
      (new Date(a.unassigned_at) - new Date(a.assigned_at)) / 1000 / 3600
    );
    if (!byDriver[a.driver_id]) byDriver[a.driver_id] = 0;
    byDriver[a.driver_id] += hours;
  }

  const { data: drivers } = await supabase
    .from("drivers")
    .select("id, name, phone, status");

  return (drivers || []).map((d) => {
    const total_hours = parseFloat((byDriver[d.id] || 0).toFixed(2));
    return {
      driver_id: d.id,
      name: d.name,
      phone: d.phone,
      status: d.status,
      total_hours,
      total_pay: parseFloat((total_hours * HOURLY_RATE).toFixed(2)),
      hourly_rate: HOURLY_RATE,
    };
  });
}

module.exports = { getDriverPay, getAllDriversPay, HOURLY_RATE };
