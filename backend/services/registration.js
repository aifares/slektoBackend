const { upsertTerminal } = require("./terminals");
const { upsertProgram } = require("./programs");
// NOTE: No longer importing batchInsertFiles - poller only UPDATES files with program_id
// Media sync is responsible for INSERTING files
const { upsertPlaying } = require("./playing");
const { insertDeviceStatus } = require("./device");
const { insertConnectivity } = require("./connectivity");
const { parseTerminalData } = require("./parser");
const { supabase } = require("../config/supabase");
const { determineOnlineStatus } = require("./statusTracking");

/**
 * NEW FLOW: Poller UPDATES files with program_id (doesn't insert)
 *
 * 1. Media sync (ColorLight) is the source of truth - INSERTS files with client_id, title, etc.
 * 2. Poller (terminal data) - UPDATES files with program_id association
 *
 * This separation allows:
 * - ColorLight media endpoint is single source of truth for files
 * - Poller only associates files with programs (doesn't create files)
 * - Clean separation: media metadata vs program associations
 */
async function updateFilesWithProgramId(files) {
  if (!files || files.length === 0) {
    return { updated: 0, notFound: 0 };
  }

  console.log(`🔄 Updating ${files.length} files with program_id...`);

  let updatedCount = 0;
  let notFoundCount = 0;

  for (const file of files) {
    try {
      const { data: existing, error: fetchError } = await supabase
        .from("files")
        .select("id, program_id")
        .eq("name", file.name)
        .maybeSingle();

      if (fetchError) {
        console.warn(
          `⚠️ Error fetching file ${file.name}:`,
          fetchError.message
        );
        continue;
      }

      if (!existing) {
        // File doesn't exist yet - media sync will add it later
        console.log(
          `ℹ️ File ${file.name} not in DB yet (will be added by media sync)`
        );
        notFoundCount++;
        continue;
      }

      // Only update if program_id changed or is null
      if (existing.program_id !== file.program_id) {
        const { error: updateError } = await supabase
          .from("files")
          .update({
            program_id: file.program_id,
            size: file.size,
            downloaded: file.downloaded,
            type: file.type,
          })
          .eq("id", existing.id);

        if (updateError) {
          console.warn(
            `⚠️ Error updating file ${file.name}:`,
            updateError.message
          );
        } else {
          console.log(
            `✅ Updated ${file.name} with program_id ${file.program_id}`
          );
          updatedCount++;
        }
      } else {
        // Already has correct program_id
        updatedCount++;
      }
    } catch (error) {
      console.error(`❌ Error processing file ${file.name}:`, error.message);
    }
  }

  console.log(
    `📊 Files: ${updatedCount} updated, ${notFoundCount} not found (waiting for media sync)`
  );
  return { updated: updatedCount, notFound: notFoundCount };
}

async function shouldSkipRegistration(parsedData) {
  console.log(
    `🔍 Checking if should skip registration for terminal: ${parsedData.terminal.terminalid}`
  );

  try {
    const { data: existingTerminal, error } = await supabase
      .from("terminals")
      .select("terminalid")
      .eq("terminalid", parsedData.terminal.terminalid)
      .single();

    console.log(`💾 Database query result:`, {
      existingTerminal,
      error: error?.code,
    });

    if (error && error.code === "PGRST116") {
      console.log(
        `📝 Terminal ${parsedData.terminal.terminalid} doesn't exist, proceeding with registration`
      );
      return false;
    }

    if (existingTerminal) {
      console.log(
        `⏭️  Terminal ${parsedData.terminal.terminalid} already exists, SKIPPING REGISTRATION`
      );
      return true;
    }

    console.log(`❓ Unexpected case - no terminal found but no error`);
    return false;
  } catch (error) {
    console.error("Error checking registration skip:", error.message);
    return false;
  }
}

async function registerTerminalData(
  terminalApiData,
  forceUpdate = false,
  skipPlaying = false
) {
  const parsedData = parseTerminalData(terminalApiData);
  const { isOnline } = determineOnlineStatus(terminalApiData);
  try {
    if (!forceUpdate) {
      const skip = await shouldSkipRegistration(parsedData);
      if (skip) {
        return {
          success: true,
          skipped: true,
          reason: "Terminal already exists - registration skipped",
          terminal_id: parsedData.terminal.terminalid,
        };
      }
    }

    const terminal = await upsertTerminal(parsedData.terminal);

    // Programs are now synced from the API separately, not from terminal data
    // Keeping this for backward compatibility but programs won't be processed here
    const programs = [];

    let filesUpdated = 0;
    if (parsedData.files.length > 0) {
      // Update files with program_id (files are inserted by media sync)
      const result = await updateFilesWithProgramId(parsedData.files);
      filesUpdated = result.updated;
    }

    console.log("isOnline", isOnline);
    let playing = null;
    if (!skipPlaying) {
      if (isOnline && parsedData.playing) {
        console.log("isOnline is true - creating playing record");
        playing = await upsertPlaying(parsedData.playing);
      } else if (!isOnline) {
        console.log("isOnline is false - skipping playing record creation");
      }
    } else {
      console.log("Skipping playing record creation (handled separately)");
    }

    const deviceStatus = await insertDeviceStatus(parsedData.deviceStatus);
    const connectivity = await insertConnectivity(parsedData.connectivity);

    return {
      success: true,
      terminal,
      programs,
      programsCount: programs.length,
      playing,
      deviceStatus,
      connectivity,
      filesCount: filesUpdated,
    };
  } catch (error) {
    throw new Error(`Failed to register terminal data: ${error.message}`);
  }
}

module.exports = {
  shouldSkipRegistration,
  registerTerminalData,
};
