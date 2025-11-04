const { fetchMediaByProgramId } = require("./media");

function matchFileToProgram(fileName, programs) {
  if (!fileName || !programs || programs.length === 0) {
    return { programId: null, programName: null };
  }

  const programNameFromFile = fileName.split("_")[0].split(".")[0];

  let matchedProgram = programs.find((p) => p.name === programNameFromFile);

  if (matchedProgram) {
    console.log(
      `🎯 Found program match: ${fileName} → ${matchedProgram.name} (ID: ${matchedProgram.id})`
    );
    return { programId: matchedProgram.id, programName: matchedProgram.name };
  }

  for (const program of programs) {
    if (program.files && program.files.some((file) => file.name === fileName)) {
      console.log(
        `🎯 Found file match: ${fileName} → ${program.name} (ID: ${program.id})`
      );
      return { programId: program.id, programName: program.name };
    }
  }

  for (const program of programs) {
    if (
      fileName.toLowerCase().includes(program.name.toLowerCase()) ||
      program.name.toLowerCase().includes(programNameFromFile.toLowerCase())
    ) {
      console.log(
        `🎯 Found partial match: ${fileName} → ${program.name} (ID: ${program.id})`
      );
      return { programId: program.id, programName: program.name };
    }
  }

  console.log(`❓ No program match found for file: ${fileName}`);
  return { programId: null, programName: programNameFromFile || fileName };
}

function parseTerminalData(terminalApiData) {
  const terminalGroup = terminalApiData.terminalgroup?.[0] || {};
  const postMeta = terminalApiData.post_meta || {};
  const ledStatus = postMeta._led_status || {};
  const rtc = ledStatus.newrtc || ledStatus.rtc || {};
  const info = ledStatus.info?.info || {};
  const infoPlaying = info.playing || {};
  const vsnsPlaying = ledStatus.vsns?.playing || {};

  console.log("🔍 Playing data comparison:");
  console.log("  info.playing:", JSON.stringify(infoPlaying, null, 2));
  console.log("  vsns.playing:", JSON.stringify(vsnsPlaying, null, 2));

  let playing;
  if (Object.keys(vsnsPlaying).length > 0 && vsnsPlaying.name) {
    playing = {
      name: vsnsPlaying.name,
      source: vsnsPlaying.type || vsnsPlaying.source || "internet",
    };
    console.log("✅ Using vsns.playing data");
  } else {
    playing = infoPlaying;
    console.log("⚠️ Falling back to info.playing data");
  }

  console.log("🎯 Selected playing data:", JSON.stringify(playing, null, 2));

  const programs = postMeta.download_status?.programs || [];

  let programMatch = { programId: null, programName: null };
  if (playing.name) {
    programMatch = matchFileToProgram(playing.name, programs);
  }

  const fourGInfo = ledStatus["4ginfo"]?.data || {};
  const ifStatus = ledStatus.ifstatus || {};

  return {
    terminal: {
      terminalid: (terminalApiData.id || terminalApiData.sn || "").toString(),
      name:
        terminalApiData.title?.rendered ||
        terminalApiData.title?.raw ||
        "Unknown Terminal",
      description:
        terminalApiData.excerpt?.rendered || terminalApiData.excerpt?.raw || "",
      author_id: terminalApiData.author,
      author_display_name: terminalApiData.extra?.author_display_name,
      group_id: terminalGroup.id,
      group_name: terminalGroup.name,
      created_at: terminalApiData.date
        ? new Date(terminalApiData.date).toISOString()
        : null,
      onboarding_status: terminalApiData.onBoardingStatus?.toString(),
      locale_country: ledStatus.locale?.country,
      locale_language: ledStatus.locale?.language,
      power_status: ledStatus.powerstatus?.powerstatus?.toString(),
      power_timestamp: ledStatus.powerstatus?._report_time
        ? new Date(ledStatus.powerstatus._report_time * 1000).toISOString()
        : null,
      last_report_time: rtc._report_time
        ? new Date(rtc._report_time * 1000).toISOString()
        : null,
      led_latest_time: postMeta._led_latest_report_time || null,
      driver_id: null,
    },
    // Programs are now synced from API, not from terminal data
    // Keeping this structure for backward compatibility but terminal_id is deprecated
    programs: programs.map((program) => ({
      id: program.id,
      name: program.name,
      // terminal_id is deprecated - programs are synced from API
      terminal_id: null,
      download_status_time: postMeta.download_status?.download_status_time
        ? new Date(
            postMeta.download_status.download_status_time * 1000
          ).toISOString()
        : null,
      files: program.files || [],
    })),
    files: programs.flatMap((program) =>
      (program.files || []).map((file) => ({
        program_id: program.id,
        name: file.name,
        size: file.total,
        downloaded: file.downloaded,
        type: file.name?.split(".").pop() || "unknown",
        created_at: null,
      }))
    ),
    playing: playing.name
      ? {
          terminal_id: (
            terminalApiData.id ||
            terminalApiData.sn ||
            ""
          ).toString(),
          program_id: programMatch.programId,
          program_name: programMatch.programName,
          file_name: playing.name,
          source: playing.source,
          started_at: rtc._report_time
            ? new Date(rtc._report_time * 1000).toISOString()
            : new Date().toISOString(),
        }
      : null,
    deviceStatus: {
      terminal_id: (terminalApiData.id || terminalApiData.sn || "").toString(),
      brightness: ledStatus.brightnessandcolortemp?.brightness
        ? Math.round(ledStatus.brightnessandcolortemp.brightness / 2.55)
        : null,
      colortemperature: ledStatus.brightnessandcolortemp?.colortemperature,
      volume: ledStatus.volume?.musicvolume,
      orientation: ledStatus.screen_orientation?.orientation,
      memory_total: info.mem?.total,
      memory_free: info.mem?.free,
      storage_total: info.storage?.total,
      storage_free: info.storage?.free,
      model: info.model,
      version: info.vername,
      report_time: ledStatus.info?._report_time
        ? new Date(ledStatus.info._report_time * 1000).toISOString()
        : null,
    },
    connectivity: {
      terminal_id: (terminalApiData.id || terminalApiData.sn || "").toString(),
      ip_address: ifStatus.types?.find((t) => t.type === "wifi ap")?.ips?.ip,
      mac_address: ifStatus.types?.find((t) => t.type === "wifi ap")?.mac,
      wifi_ssid: ifStatus.types?.find((t) => t.type === "wifi ap")?.SSID,
      operator_name: fourGInfo.operatorname,
      sim_serial: fourGInfo.simserial,
      imsi: fourGInfo.imsi,
      deviceid: fourGInfo.deviceid,
      netstat: JSON.stringify(ifStatus.types || []),
      wifi: ifStatus.types?.find((t) => t.type === "wifi")?.enabled?.toString(),
      lan: ifStatus.types?.find((t) => t.type === "lan")?.enabled?.toString(),
      fourg: ifStatus.types?.find((t) => t.type === "4G")?.enabled?.toString(),
      gps: JSON.stringify(postMeta.geo_coordinate || {}),
    },
  };
}

module.exports = {
  matchFileToProgram,
  parseTerminalData,
};
