const { supabase } = require("../config/supabase");

const HOURLY_RATE = parseFloat(process.env.DRIVER_HOURLY_RATE || "3.00");

function shiftHours(assigned_at, unassigned_at) {
  return Math.max(0, (new Date(unassigned_at) - new Date(assigned_at)) / 1000 / 3600);
}

// "2026-04" key for grouping by pay period
function periodKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(key) {
  const [year, month] = key.split("-");
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleString("en-US", { month: "long", year: "numeric" });
}

// "2026-04-18" key for grouping by date
function dateKey(dateStr) {
  return new Date(dateStr).toISOString().slice(0, 10);
}

/**
 * Get driver pay broken down by monthly pay period.
 * Each period contains daily breakdowns with hours per shift.
 */
async function getDriverPay(driverId) {
  const [{ data: assignments, error }, { data: activeShifts }, { data: paidPeriods }] = await Promise.all([
    supabase
      .from("terminal_driver_assignments")
      .select("id, terminal_id, assigned_at, unassigned_at, notes, terminals(name)")
      .eq("driver_id", driverId)
      .not("unassigned_at", "is", null)
      .order("assigned_at", { ascending: false }),
    supabase
      .from("terminal_driver_assignments")
      .select("id, terminal_id, assigned_at, terminals(name)")
      .eq("driver_id", driverId)
      .is("unassigned_at", null)
      .order("assigned_at", { ascending: false })
      .limit(1),
    supabase
      .from("driver_pay_periods")
      .select("period, paid_at, paid_by, notes, total_hours, total_pay")
      .eq("driver_id", driverId),
  ]);

  if (error) throw new Error(`Failed to fetch assignments: ${error.message}`);

  // Index paid periods by "YYYY-MM" key
  const paidByPeriod = {};
  for (const p of paidPeriods || []) {
    paidByPeriod[p.period] = { paid_at: p.paid_at, paid_by: p.paid_by, notes: p.notes };
  }

  // Build per-period → per-day → shifts structure
  const periods = {};

  for (const a of assignments || []) {
    const hours = parseFloat(shiftHours(a.assigned_at, a.unassigned_at).toFixed(2));
    const pay = parseFloat((hours * HOURLY_RATE).toFixed(2));
    const pKey = periodKey(a.assigned_at);
    const dKey = dateKey(a.assigned_at);

    if (!periods[pKey]) {
      periods[pKey] = { period: pKey, label: periodLabel(pKey), days: {}, total_hours: 0, total_pay: 0 };
    }

    if (!periods[pKey].days[dKey]) {
      periods[pKey].days[dKey] = { date: dKey, shifts: [], day_hours: 0, day_pay: 0 };
    }

    periods[pKey].days[dKey].shifts.push({
      id: a.id,
      terminal_id: a.terminal_id,
      terminal_name: a.terminals?.name || null,
      start: a.assigned_at,
      end: a.unassigned_at,
      hours,
      pay,
      notes: a.notes || null,
    });

    periods[pKey].days[dKey].day_hours = parseFloat((periods[pKey].days[dKey].day_hours + hours).toFixed(2));
    periods[pKey].days[dKey].day_pay = parseFloat((periods[pKey].days[dKey].day_pay + pay).toFixed(2));
    periods[pKey].total_hours = parseFloat((periods[pKey].total_hours + hours).toFixed(2));
    periods[pKey].total_pay = parseFloat((periods[pKey].total_pay + pay).toFixed(2));
  }

  // Flatten days map to sorted array within each period
  const pay_periods = Object.values(periods)
    .sort((a, b) => b.period.localeCompare(a.period))
    .map((p) => {
      const paid = paidByPeriod[p.period] || null;
      return {
        period: p.period,
        label: p.label,
        total_hours: p.total_hours,
        total_pay: p.total_pay,
        paid: !!paid,
        paid_at: paid?.paid_at || null,
        paid_by: paid?.paid_by || null,
        payment_notes: paid?.notes || null,
        days: Object.values(p.days).sort((a, b) => b.date.localeCompare(a.date)),
      };
    });

  const total_hours = parseFloat(pay_periods.reduce((s, p) => s + p.total_hours, 0).toFixed(2));
  const total_pay = parseFloat((total_hours * HOURLY_RATE).toFixed(2));

  const active_shift =
    activeShifts && activeShifts.length > 0
      ? {
          id: activeShifts[0].id,
          terminal_id: activeShifts[0].terminal_id,
          terminal_name: activeShifts[0].terminals?.name || null,
          start: activeShifts[0].assigned_at,
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
    pay_periods,
  };
}

/**
 * Get pay summaries for all drivers (admin view), broken down by pay period.
 */
async function getAllDriversPay() {
  const { data: assignments, error } = await supabase
    .from("terminal_driver_assignments")
    .select("driver_id, assigned_at, unassigned_at")
    .not("unassigned_at", "is", null);

  if (error) throw new Error(`Failed to fetch assignments: ${error.message}`);

  const byDriver = {};
  for (const a of assignments || []) {
    const hours = shiftHours(a.assigned_at, a.unassigned_at);
    const pKey = periodKey(a.assigned_at);
    if (!byDriver[a.driver_id]) byDriver[a.driver_id] = { total: 0, periods: {} };
    byDriver[a.driver_id].total += hours;
    if (!byDriver[a.driver_id].periods[pKey]) byDriver[a.driver_id].periods[pKey] = 0;
    byDriver[a.driver_id].periods[pKey] += hours;
  }

  const { data: drivers } = await supabase
    .from("drivers")
    .select("id, name, phone, status");

  return (drivers || []).map((d) => {
    const entry = byDriver[d.id] || { total: 0, periods: {} };
    const total_hours = parseFloat(entry.total.toFixed(2));
    const pay_periods = Object.entries(entry.periods)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, hours]) => ({
        period: key,
        label: periodLabel(key),
        total_hours: parseFloat(hours.toFixed(2)),
        total_pay: parseFloat((hours * HOURLY_RATE).toFixed(2)),
      }));

    return {
      driver_id: d.id,
      name: d.name,
      phone: d.phone,
      status: d.status,
      hourly_rate: HOURLY_RATE,
      total_hours,
      total_pay: parseFloat((total_hours * HOURLY_RATE).toFixed(2)),
      pay_periods,
    };
  });
}

module.exports = { getDriverPay, getAllDriversPay, HOURLY_RATE };
