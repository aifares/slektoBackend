const { supabase } = require("../config/supabase");

async function upsertProgram(programData) {
  const { data, error } = await supabase
    .from("programs")
    .upsert(programData, { onConflict: "id" })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert program: ${error.message}`);
  return data;
}

async function getProgramsByTerminal(terminalId) {
  const { data, error } = await supabase
    .from("programs")
    .select("*")
    .eq("terminal_id", terminalId);

  if (error) throw new Error(`Failed to get programs: ${error.message}`);
  return data;
}

module.exports = {
  upsertProgram,
  getProgramsByTerminal,
};
