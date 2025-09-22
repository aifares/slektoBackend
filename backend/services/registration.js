const { upsertTerminal } = require("./terminals");
const { upsertProgram } = require("./programs");
const { batchInsertFiles } = require("./files");
const { upsertPlaying } = require("./playing");
const { insertDeviceStatus } = require("./device");
const { insertConnectivity } = require("./connectivity");
const { parseTerminalData } = require("./parser");
const { supabase } = require("../config/supabase");

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

async function registerTerminalData(terminalApiData, forceUpdate = false) {
  const parsedData = parseTerminalData(terminalApiData);

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

    const programs = [];
    if (parsedData.programs && parsedData.programs.length > 0) {
      for (const programData of parsedData.programs) {
        const program = await upsertProgram(programData);
        programs.push(program);
      }
    }

    let filesInserted = 0;
    if (parsedData.files.length > 0) {
      await batchInsertFiles(parsedData.files);
      filesInserted = parsedData.files.length;
    }

    let playing = null;
    if (parsedData.playing) {
      playing = await upsertPlaying(parsedData.playing);
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
      filesCount: filesInserted,
    };
  } catch (error) {
    throw new Error(`Failed to register terminal data: ${error.message}`);
  }
}

module.exports = {
  shouldSkipRegistration,
  registerTerminalData,
};
