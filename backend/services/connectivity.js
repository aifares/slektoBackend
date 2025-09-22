const { supabase } = require("../config/supabase");

async function insertConnectivity(connectivityData) {
  const { data, error } = await supabase
    .from("connectivity")
    .upsert(connectivityData, { onConflict: "terminal_id" })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert connectivity: ${error.message}`);
  return data;
}

async function getLatestConnectivity(terminalId) {
  const { data, error } = await supabase
    .from("connectivity")
    .select("*")
    .eq("terminal_id", terminalId)
    .order("id", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to get connectivity: ${error.message}`);
  }
  return data;
}

module.exports = {
  insertConnectivity,
  getLatestConnectivity,
};
