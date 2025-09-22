const { supabase } = require("../config/supabase");

async function insertDeviceStatus(statusData) {
  const { data, error } = await supabase
    .from("device_status")
    .upsert(statusData, { onConflict: "terminal_id" })
    .select()
    .single();

  if (error)
    throw new Error(`Failed to upsert device status: ${error.message}`);
  return data;
}

async function getLatestDeviceStatus(terminalId) {
  const { data, error } = await supabase
    .from("device_status")
    .select("*")
    .eq("terminal_id", terminalId)
    .order("report_time", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to get device status: ${error.message}`);
  }
  return data;
}

module.exports = {
  insertDeviceStatus,
  getLatestDeviceStatus,
};
