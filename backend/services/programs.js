const { supabase } = require("../config/supabase");
const axios = require("axios");
const { COLORLIGHT_PROGRAMS_URL, PROGRAMS_AUTH_HEADER } = require("../utils");

async function upsertProgram(programData) {
  const { data, error } = await supabase
    .from("programs")
    .upsert(programData, { onConflict: "id" })
    .select()
    .single();

  if (error) throw new Error(`Failed to upsert program: ${error.message}`);
  return data;
}

async function syncProgramsFromAPI() {
  try {
    console.log("🔄 Syncing programs from API...");
    
    // Fetch all programs from API with pagination
    let allPrograms = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(COLORLIGHT_PROGRAMS_URL, {
        ...PROGRAMS_AUTH_HEADER,
        params: {
          page,
          per_page: 100, // Max per page
          orderby: "modified",
          status: "any",
          mime_type: "normal",
          _embed: true,
          lazyLoad: true,
        },
        timeout: 30000,
      });

      const programs = response.data;
      if (Array.isArray(programs) && programs.length > 0) {
        allPrograms = allPrograms.concat(programs);
        // Check if there are more pages
        const totalPages = parseInt(response.headers["x-wp-totalpages"] || "1");
        hasMore = page < totalPages;
        page++;
      } else {
        hasMore = false;
      }
    }

    console.log(`📦 Fetched ${allPrograms.length} programs from API`);

    // Transform and upsert each program
    const upsertPromises = allPrograms.map(async (apiProgram) => {
      try {
        const programData = {
          id: apiProgram.id,
          name: apiProgram.title_raw || apiProgram.title?.rendered || "Unknown Program",
          thumbnail_url: apiProgram.program_source_thumbnail || null,
          modified: apiProgram.modified || apiProgram.modified_gmt || null,
          created: apiProgram.date || apiProgram.date_gmt || null,
          status: apiProgram.status || null,
          author_id: apiProgram.author || null,
        };

        await upsertProgram(programData);
        return { id: apiProgram.id, success: true };
      } catch (error) {
        console.error(
          `❌ Failed to upsert program ${apiProgram.id}:`,
          error.message
        );
        return { id: apiProgram.id, success: false, error: error.message };
      }
    });

    const results = await Promise.allSettled(upsertPromises);
    const successful = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;
    const failed = results.length - successful;

    console.log(
      `✅ Program sync complete: ${successful} successful, ${failed} failed`
    );

    return {
      total: allPrograms.length,
      successful,
      failed,
    };
  } catch (error) {
    console.error("❌ Failed to sync programs from API:", error.message);
    throw new Error(`Failed to sync programs: ${error.message}`);
  }
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
  syncProgramsFromAPI,
};
