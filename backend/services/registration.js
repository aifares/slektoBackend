const { upsertTerminal } = require("./terminals");
const { upsertProgram } = require("./programs");
// NOTE: Files are managed entirely by media sync from ColorLight
// Media sync sets program_id from attachment_program field
const { upsertPlaying } = require("./playing");
const { insertDeviceStatus } = require("./device");
const { insertConnectivity } = require("./connectivity");
const { parseTerminalData } = require("./parser");
const { supabase } = require("../config/supabase");
const { determineOnlineStatus } = require("./statusTracking");

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

    // Files are managed entirely by media sync from ColorLight
    // program_id comes from attachment_program field in ColorLight API response

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
    };
  } catch (error) {
    throw new Error(`Failed to register terminal data: ${error.message}`);
  }
}

module.exports = {
  shouldSkipRegistration,
  registerTerminalData,
};
