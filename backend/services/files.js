const { supabase } = require("../config/supabase");

async function upsertFile(fileData) {
  const { data, error } = await supabase
    .from("files")
    .upsert(fileData)
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert file: ${error.message}`);
  return data;
}

async function batchInsertFiles(filesData) {
  const { data, error } = await supabase
    .from("files")
    .upsert(filesData)
    .select();

  if (error) throw new Error(`Failed to batch insert files: ${error.message}`);
  return data;
}

module.exports = {
  upsertFile,
  batchInsertFiles,
};
