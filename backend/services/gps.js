const { supabase } = require("../config/supabase");

async function insertTerminalGpsPoints(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("terminal_gps_data")
    .insert(rows)
    .select();

  if (error) {
    throw new Error(`Failed to insert terminal_gps_data: ${error.message}`);
  }
  return data || [];
}

module.exports = {
  insertTerminalGpsPoints,
};
