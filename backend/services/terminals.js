const { supabase } = require("../config/supabase");

async function upsertTerminal(terminalData) {
  const { data, error } = await supabase
    .from("terminals")
    .upsert(terminalData, { onConflict: "terminalid" })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert terminal: ${error.message}`);
  return data;
}

async function getTerminal(terminalId) {
  const { data, error } = await supabase
    .from("terminals")
    .select("*")
    .eq("terminalid", terminalId)
    .single();

  if (error) throw new Error(`Failed to get terminal: ${error.message}`);
  return data;
}

async function getAllTerminals() {
  const { data, error } = await supabase
    .from("terminals")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to get terminals: ${error.message}`);
  return data;
}

module.exports = {
  upsertTerminal,
  getTerminal,
  getAllTerminals,
};
