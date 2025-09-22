const { supabase } = require("../config/supabase");

async function upsertDriver(driverData) {
  const { data, error } = await supabase
    .from("drivers")
    .upsert(driverData, { onConflict: "id" })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert driver: ${error.message}`);
  return data;
}

async function getDriver(driverId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .single();

  if (error) throw new Error(`Failed to get driver: ${error.message}`);
  return data;
}

module.exports = {
  upsertDriver,
  getDriver,
};
