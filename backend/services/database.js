const { supabase } = require("../config/supabase");

class DatabaseService {
  // ========== DRIVERS ==========

  /**
   * Create or update a driver
   * @param {Object} driverData - Driver information
   * @returns {Promise<Object>} Created/updated driver
   */
  async upsertDriver(driverData) {
    const { data, error } = await supabase
      .from("drivers")
      .upsert(driverData, { onConflict: "id" })
      .select()
      .single();

    if (error) throw new Error(`Failed to upsert driver: ${error.message}`);
    return data;
  }

  /**
   * Get driver by ID
   * @param {number} driverId - Driver ID
   * @returns {Promise<Object>} Driver data
   */
  async getDriver(driverId) {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("id", driverId)
      .single();

    if (error) throw new Error(`Failed to get driver: ${error.message}`);
    return data;
  }

  // ========== TERMINALS ==========

  /**
   * Create or update terminal information
   * @param {Object} terminalData - Terminal data from API
   * @returns {Promise<Object>} Created/updated terminal
   */
  async upsertTerminal(terminalData) {
    const { data, error } = await supabase
      .from("terminals")
      .upsert(terminalData, { onConflict: "terminalid" })
      .select()
      .single();

    if (error) throw new Error(`Failed to upsert terminal: ${error.message}`);
    return data;
  }

  /**
   * Get terminal by ID
   * @param {string} terminalId - Terminal ID
   * @returns {Promise<Object>} Terminal data
   */
  async getTerminal(terminalId) {
    const { data, error } = await supabase
      .from("terminals")
      .select("*")
      .eq("terminalid", terminalId)
      .single();

    if (error) throw new Error(`Failed to get terminal: ${error.message}`);
    return data;
  }

  /**
   * Get all terminals
   * @returns {Promise<Array>} All terminals
   */
  async getAllTerminals() {
    const { data, error } = await supabase
      .from("terminals")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Failed to get terminals: ${error.message}`);
    return data;
  }

  // ========== PROGRAMS ==========

  /**
   * Create or update program information
   * @param {Object} programData - Program data
   * @returns {Promise<Object>} Created/updated program
   */
  async upsertProgram(programData) {
    const { data, error } = await supabase
      .from("programs")
      .upsert(programData, { onConflict: "id" })
      .select()
      .single();

    if (error) throw new Error(`Failed to upsert program: ${error.message}`);
    return data;
  }

  /**
   * Get programs for a terminal
   * @param {string} terminalId - Terminal ID
   * @returns {Promise<Array>} Programs for the terminal
   */
  async getProgramsByTerminal(terminalId) {
    const { data, error } = await supabase
      .from("programs")
      .select("*")
      .eq("terminal_id", terminalId);

    if (error) throw new Error(`Failed to get programs: ${error.message}`);
    return data;
  }

  // ========== FILES ==========

  /**
   * Create or update file information
   * @param {Object} fileData - File data
   * @returns {Promise<Object>} Created/updated file
   */
  async upsertFile(fileData) {
    const { data, error } = await supabase
      .from("files")
      .upsert(fileData)
      .select()
      .single();

    if (error) throw new Error(`Failed to upsert file: ${error.message}`);
    return data;
  }

  /**
   * Batch insert files for a program
   * @param {Array} filesData - Array of file data
   * @returns {Promise<Array>} Created files
   */
  async batchInsertFiles(filesData) {
    const { data, error } = await supabase
      .from("files")
      .upsert(filesData)
      .select();

    if (error)
      throw new Error(`Failed to batch insert files: ${error.message}`);
    return data;
  }

  // ========== PLAYING ==========

  /**
   * Update currently playing content
   * @param {Object} playingData - Currently playing data
   * @returns {Promise<Object>} Created/updated playing record
   */
  async upsertPlaying(playingData) {
    const now = new Date().toISOString();

    console.log(
      "🎬 upsertPlaying called with data:",
      JSON.stringify(playingData, null, 2)
    );

    // First, check if the same content is already playing
    const { data: existingRecords, error: fetchError } = await supabase
      .from("playing")
      .select("*")
      .eq("terminal_id", playingData.terminal_id)
      .eq("status", "current");

    if (fetchError)
      throw new Error(
        `Failed to fetch existing playing records: ${fetchError.message}`
      );

    // Check if the same file is already playing
    if (existingRecords && existingRecords.length > 0) {
      const currentRecord = existingRecords[0];

      // If same file is already playing, just return the existing record
      if (
        currentRecord.file_name === playingData.file_name &&
        currentRecord.source === playingData.source
      ) {
        console.log(
          `📹 Same content already playing: ${playingData.file_name} (${playingData.program_name})`
        );
        return currentRecord;
      }

      // Different content - move existing records to completed
      for (const record of existingRecords) {
        const duration = record.started_at
          ? Math.round((new Date(now) - new Date(record.started_at)) / 1000)
          : null;

        const { error: updateError } = await supabase
          .from("playing")
          .update({
            status: "completed",
            ended_at: now,
            duration_seconds: duration,
          })
          .eq("id", record.id);

        if (updateError) {
          console.warn(
            `Failed to update playing record ${record.id} to completed:`,
            updateError.message
          );
        } else {
          console.log(
            `✅ Moved playing record ${record.id} to completed (${record.file_name})`
          );
        }
      }
    }

    // Insert new playing record with 'current' status
    const newPlayingData = {
      ...playingData,
      status: "current",
      started_at: playingData.started_at || now,
    };

    const { data, error } = await supabase
      .from("playing")
      .insert(newPlayingData)
      .select()
      .single();

    if (error) throw new Error(`Failed to upsert playing: ${error.message}`);

    console.log(
      `🎬 New playing record created: ${newPlayingData.file_name} (${newPlayingData.program_name})`
    );
    return data;
  }

  /**
   * Get currently playing content for a terminal
   * @param {string} terminalId - Terminal ID
   * @returns {Promise<Object>} Currently playing data
   */
  async getCurrentlyPlaying(terminalId) {
    const { data, error } = await supabase
      .from("playing")
      .select("*")
      .eq("terminal_id", terminalId)
      .eq("status", "current")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 is "no rows returned"
      throw new Error(`Failed to get currently playing: ${error.message}`);
    }
    return data;
  }

  /**
   * Get recently played content for a terminal
   * @param {string} terminalId - Terminal ID
   * @param {number} limit - Number of recent records to fetch (default: 10)
   * @returns {Promise<Array>} Recently played data
   */
  async getRecentlyPlayed(terminalId, limit = 10) {
    const { data, error } = await supabase
      .from("playing")
      .select("*")
      .eq("terminal_id", terminalId)
      .in("status", ["completed", "stopped"])
      .order("ended_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to get recently played: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get all playback history for a terminal (current + recent)
   * @param {string} terminalId - Terminal ID
   * @param {number} recentLimit - Number of recent records to include (default: 10)
   * @returns {Promise<Object>} Object with current and recent playing data
   */
  async getPlaybackHistory(terminalId, recentLimit = 10) {
    const [currentPlaying, recentlyPlayed] = await Promise.all([
      this.getCurrentlyPlaying(terminalId).catch(() => null),
      this.getRecentlyPlayed(terminalId, recentLimit),
    ]);

    return {
      current: currentPlaying,
      recent: recentlyPlayed,
      totalRecent: recentlyPlayed.length,
    };
  }

  // ========== DEVICE STATUS ==========

  /**
   * Create device status record
   * @param {Object} statusData - Device status data
   * @returns {Promise<Object>} Created status record
   */
  async insertDeviceStatus(statusData) {
    // Use upsert since terminal_id is now the primary key (one record per terminal)
    const { data, error } = await supabase
      .from("device_status")
      .upsert(statusData, { onConflict: "terminal_id" })
      .select()
      .single();

    if (error)
      throw new Error(`Failed to upsert device status: ${error.message}`);
    return data;
  }

  /**
   * Get latest device status for a terminal
   * @param {string} terminalId - Terminal ID
   * @returns {Promise<Object>} Latest device status
   */
  async getLatestDeviceStatus(terminalId) {
    const { data, error } = await supabase
      .from("device_status")
      .select("*")
      .eq("terminal_id", terminalId)
      .order("report_time", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error(`Failed to get device status: ${error.message}`);
    }
    return data;
  }

  // ========== CONNECTIVITY ==========

  /**
   * Create or update connectivity information
   * @param {Object} connectivityData - Connectivity data
   * @returns {Promise<Object>} Created connectivity record
   */
  async insertConnectivity(connectivityData) {
    // Use upsert since terminal_id is now the primary key (one record per terminal)
    const { data, error } = await supabase
      .from("connectivity")
      .upsert(connectivityData, { onConflict: "terminal_id" })
      .select()
      .single();

    if (error)
      throw new Error(`Failed to upsert connectivity: ${error.message}`);
    return data;
  }

  /**
   * Get latest connectivity info for a terminal
   * @param {string} terminalId - Terminal ID
   * @returns {Promise<Object>} Latest connectivity data
   */
  async getLatestConnectivity(terminalId) {
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

  // ========== UTILITY METHODS ==========

  /**
   * Match a playing file name to its program information
   * @param {string} fileName - The playing file name
   * @param {Array} programs - Array of program objects from API
   * @returns {Object} - {programId, programName} or {programId: null, programName: null}
   */
  matchFileToProgram(fileName, programs) {
    if (!fileName || !programs || programs.length === 0) {
      return { programId: null, programName: null };
    }

    // Strategy 1: Direct program name match from file name
    // File format: "ProgramName_hash_size.vsn" or "ProgramName.vsn"
    const programNameFromFile = fileName.split("_")[0].split(".")[0];

    // Look for exact program name match
    let matchedProgram = programs.find((p) => p.name === programNameFromFile);

    if (matchedProgram) {
      console.log(
        `🎯 Found program match: ${fileName} → ${matchedProgram.name} (ID: ${matchedProgram.id})`
      );
      return {
        programId: matchedProgram.id,
        programName: matchedProgram.name,
      };
    }

    // Strategy 2: Check if file exists in any program's files array
    for (const program of programs) {
      if (
        program.files &&
        program.files.some((file) => file.name === fileName)
      ) {
        console.log(
          `🎯 Found file match: ${fileName} → ${program.name} (ID: ${program.id})`
        );
        return {
          programId: program.id,
          programName: program.name,
        };
      }
    }

    // Strategy 3: Partial name matching for edge cases
    for (const program of programs) {
      if (
        fileName.toLowerCase().includes(program.name.toLowerCase()) ||
        program.name.toLowerCase().includes(programNameFromFile.toLowerCase())
      ) {
        console.log(
          `🎯 Found partial match: ${fileName} → ${program.name} (ID: ${program.id})`
        );
        return {
          programId: program.id,
          programName: program.name,
        };
      }
    }

    console.log(`❓ No program match found for file: ${fileName}`);
    return {
      programId: null,
      programName: programNameFromFile || fileName, // Use extracted name as fallback
    };
  }

  /**
   * Check if registration should be skipped based on terminal ID existence
   * @param {Object} parsedData - Parsed terminal data
   * @returns {Promise<boolean>} True if registration should be skipped
   */
  async shouldSkipRegistration(parsedData) {
    console.log(
      `🔍 Checking if should skip registration for terminal: ${parsedData.terminal.terminalid}`
    );

    try {
      // Check if terminal ID already exists
      const { data: existingTerminal, error } = await supabase
        .from("terminals")
        .select("terminalid")
        .eq("terminalid", parsedData.terminal.terminalid)
        .single();

      console.log(`💾 Database query result:`, {
        existingTerminal,
        error: error?.code,
      });

      // If terminal doesn't exist, don't skip (allow registration)
      if (error && error.code === "PGRST116") {
        console.log(
          `📝 Terminal ${parsedData.terminal.terminalid} doesn't exist, proceeding with registration`
        );
        return false;
      }

      // If terminal exists, skip registration
      if (existingTerminal) {
        console.log(
          `⏭️  Terminal ${parsedData.terminal.terminalid} already exists, SKIPPING REGISTRATION`
        );
        return true;
      }

      console.log(`❓ Unexpected case - no terminal found but no error`);
      return false;
    } catch (error) {
      // If there's an error checking, don't skip (proceed with registration)
      console.error("Error checking registration skip:", error.message);
      return false;
    }
  }

  /**
   * Parse terminal data from API response and prepare for database insertion
   * @param {Object} terminalApiData - Raw terminal data from API
   * @returns {Object} Parsed data ready for database insertion
   */
  parseTerminalData(terminalApiData) {
    // Handle the actual API structure from ColorLight
    const terminalGroup = terminalApiData.terminalgroup?.[0] || {};
    const postMeta = terminalApiData.post_meta || {};
    const ledStatus = postMeta._led_status || {};
    const rtc = ledStatus.newrtc || ledStatus.rtc || {};
    const info = ledStatus.info?.info || {};
    const infoPlaying = info.playing || {};
    const vsnsPlaying = ledStatus.vsns?.playing || {};

    // Debug: Log both playing sources to understand discrepancies
    console.log("🔍 Playing data comparison:");
    console.log("  info.playing:", JSON.stringify(infoPlaying, null, 2));
    console.log("  vsns.playing:", JSON.stringify(vsnsPlaying, null, 2));

    // Use vsns.playing as primary source (more up-to-date), fallback to info.playing
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

    // Match playing file to program if playing data exists
    let programMatch = { programId: null, programName: null };
    if (playing.name) {
      programMatch = this.matchFileToProgram(playing.name, programs);
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
          terminalApiData.excerpt?.rendered ||
          terminalApiData.excerpt?.raw ||
          "",
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
        driver_id: null, // Will be set manually or through separate assignment
      },
      programs: programs.map((program) => ({
        id: program.id,
        name: program.name,
        terminal_id: (
          terminalApiData.id ||
          terminalApiData.sn ||
          ""
        ).toString(),
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
          created_at: null, // Not available in this API structure
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
        terminal_id: (
          terminalApiData.id ||
          terminalApiData.sn ||
          ""
        ).toString(),
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
        terminal_id: (
          terminalApiData.id ||
          terminalApiData.sn ||
          ""
        ).toString(),
        ip_address: ifStatus.types?.find((t) => t.type === "wifi ap")?.ips?.ip,
        mac_address: ifStatus.types?.find((t) => t.type === "wifi ap")?.mac,
        wifi_ssid: ifStatus.types?.find((t) => t.type === "wifi ap")?.SSID,
        operator_name: fourGInfo.operatorname,
        sim_serial: fourGInfo.simserial,
        imsi: fourGInfo.imsi,
        deviceid: fourGInfo.deviceid,
        netstat: JSON.stringify(ifStatus.types || []),
        wifi: ifStatus.types
          ?.find((t) => t.type === "wifi")
          ?.enabled?.toString(),
        lan: ifStatus.types?.find((t) => t.type === "lan")?.enabled?.toString(),
        fourg: ifStatus.types
          ?.find((t) => t.type === "4G")
          ?.enabled?.toString(),
        gps: JSON.stringify(postMeta.geo_coordinate || {}),
      },
    };
  }

  /**
   * Register complete terminal data to database
   * @param {Object} terminalApiData - Raw terminal data from API
   * @param {boolean} forceUpdate - Force update even if data hasn't changed
   * @returns {Promise<Object>} Registration result
   */
  async registerTerminalData(terminalApiData, forceUpdate = false) {
    const parsedData = this.parseTerminalData(terminalApiData);

    try {
      // Check if we should skip registration based on existing data
      if (!forceUpdate) {
        const shouldSkip = await this.shouldSkipRegistration(parsedData);
        if (shouldSkip) {
          return {
            success: true,
            skipped: true,
            reason: "Terminal already exists - registration skipped",
            terminal_id: parsedData.terminal.terminalid,
          };
        }
      }

      // Insert/update terminal
      const terminal = await this.upsertTerminal(parsedData.terminal);

      // Insert/update programs if they exist
      const programs = [];
      if (parsedData.programs && parsedData.programs.length > 0) {
        for (const programData of parsedData.programs) {
          const program = await this.upsertProgram(programData);
          programs.push(program);
        }
      }

      // Insert files if they exist
      let filesInserted = 0;
      if (parsedData.files.length > 0) {
        await this.batchInsertFiles(parsedData.files);
        filesInserted = parsedData.files.length;
      }

      // Insert/update currently playing if exists
      let playing = null;
      if (parsedData.playing) {
        playing = await this.upsertPlaying(parsedData.playing);
      }

      // Insert device status
      const deviceStatus = await this.insertDeviceStatus(
        parsedData.deviceStatus
      );

      // Insert connectivity info
      const connectivity = await this.insertConnectivity(
        parsedData.connectivity
      );

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

  // ========== TERMINAL STATUS TRACKING ==========

  /**
   * Determine if a terminal is online using the same logic as /powerstatus
   * @param {Object} terminalData - Terminal data from API
   * @returns {Object} - { isOnline, reason, indicators }
   */
  determineOnlineStatus(terminalData) {
    const currentTime = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
    const OFFLINE_THRESHOLD = 90; // 90 seconds threshold (same as /powerstatus)

    const lastReportTime = terminalData.post_meta?._led_latest_report_time;

    if (!lastReportTime) {
      return {
        isOnline: false,
        reason: "no_report_time",
        indicators: {
          lastReportTime: null,
          timeSinceLastReport: null,
          threshold: OFFLINE_THRESHOLD,
        },
      };
    }

    const timeSinceLastReport = currentTime - lastReportTime;
    const isOnline = timeSinceLastReport <= OFFLINE_THRESHOLD;

    return {
      isOnline,
      reason: isOnline ? "online" : "offline",
      indicators: {
        lastReportTime,
        timeSinceLastReport,
        threshold: OFFLINE_THRESHOLD,
        lastReportDate: new Date(lastReportTime * 1000).toISOString(),
      },
    };
  }

  /**
   * Get the current status of a terminal from the database
   * @param {string} terminalId - Terminal ID
   * @returns {Promise<Object|null>} - Current status record or null
   */
  async getCurrentTerminalStatus(terminalId) {
    try {
      const { data, error } = await supabase
        .from("terminal_status_log")
        .select("*")
        .eq("terminal_id", terminalId)
        .order("status_changed_at", { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows found
        throw new Error(`Failed to get current status: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error(
        `Error getting current status for ${terminalId}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Log a terminal status change
   * @param {Object} statusData - Status change data
   * @returns {Promise<Object>} - Created status record
   */
  async logTerminalStatusChange(statusData) {
    try {
      const { data, error } = await supabase
        .from("terminal_status_log")
        .insert(statusData)
        .select()
        .single();

      if (error)
        throw new Error(`Failed to log status change: ${error.message}`);

      console.log(
        `📊 Status logged: ${statusData.terminal_id} is ${statusData.status} (${statusData.reason})`
      );
      return data;
    } catch (error) {
      console.error(`Error logging status change:`, error.message);
      throw error;
    }
  }

  /**
   * Update terminal status if it has changed
   * @param {string} terminalId - Terminal ID
   * @param {Object} terminalData - Current terminal data from API
   * @returns {Promise<Object|null>} - Status change record or null if no change
   */
  async updateTerminalStatus(terminalId, terminalData) {
    try {
      const { isOnline, reason, indicators } =
        this.determineOnlineStatus(terminalData);
      const currentStatus = await this.getCurrentTerminalStatus(terminalId);

      // Normalize commonly used fields from either parsed or raw API data
      const powerStatus =
        terminalData?.power_status ??
        terminalData?.post_meta?._led_status?.powerstatus?.powerstatus?.toString?.() ??
        null;
      const ledLatestTime =
        terminalData?.led_latest_time ??
        terminalData?.post_meta?._led_latest_report_time ??
        null;

      // If no previous status or status has changed
      if (
        !currentStatus ||
        currentStatus.status !== (isOnline ? "online" : "offline")
      ) {
        const now = new Date().toISOString();

        // If there is a previous status session, close it by updating its duration
        if (currentStatus) {
          const previousChangeTime = new Date(currentStatus.status_changed_at);
          const durationSeconds = Math.round(
            (new Date(now) - previousChangeTime) / 1000
          );

          console.log(
            `⏱️ Closing previous status row id=${currentStatus.id} (${currentStatus.status}) with duration_seconds=${durationSeconds}`
          );

          const { error: prevUpdateError } = await supabase
            .from("terminal_status_log")
            .update({
              duration_seconds: durationSeconds,
              api_response_at: now,
            })
            .eq("id", currentStatus.id);

          if (prevUpdateError) {
            console.warn(
              `⚠️ Failed to update previous status row ${currentStatus.id}: ${prevUpdateError.message}`
            );
          }
        }

        const statusData = {
          terminal_id: terminalId,
          status: isOnline ? "online" : "offline",
          status_changed_at: now,
          duration_seconds: null, // open session; will be set when status changes again
          power_status: powerStatus,
          led_activity_at: ledLatestTime
            ? new Date(ledLatestTime * 1000).toISOString()
            : null,
          api_response_at: now,
          reason: reason,
        };

        console.log(
          `🆕 Inserting new status row for ${terminalId}: ${statusData.status} (duration_seconds should be null)`
        );
        const newStatus = await this.logTerminalStatusChange(statusData);
        console.log(
          `✅ Inserted status row id=${newStatus.id} status=${newStatus.status} duration_seconds=${newStatus.duration_seconds}`
        );
        return newStatus;
      }

      // Status hasn't changed, just update API response time
      if (currentStatus) {
        await supabase
          .from("terminal_status_log")
          .update({ api_response_at: new Date().toISOString() })
          .eq("id", currentStatus.id);
      }

      return null; // No status change
    } catch (error) {
      console.error(
        `Error updating terminal status for ${terminalId}:`,
        error.message
      );
      return null;
    }
  }

  /**
   * Get terminal uptime analytics for a specific period
   * @param {string} terminalId - Terminal ID (optional, null for all terminals)
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Object>} - Uptime analytics
   */
  async getTerminalUptimeAnalytics(terminalId = null, startDate, endDate) {
    try {
      let query = supabase
        .from("terminal_status_log")
        .select(
          "terminal_id, status, status_changed_at, duration_seconds, reason"
        )
        .gte("status_changed_at", `${startDate}T00:00:00`)
        .lt("status_changed_at", `${endDate}T23:59:59`);

      if (terminalId) {
        query = query.eq("terminal_id", terminalId);
      }

      const { data, error } = await query;

      if (error)
        throw new Error(`Failed to fetch uptime analytics: ${error.message}`);

      // Group by terminal and calculate analytics
      const analytics = {};

      data.forEach((record) => {
        const tid = record.terminal_id;
        if (!analytics[tid]) {
          analytics[tid] = {
            terminal_id: tid,
            total_online_seconds: 0,
            total_offline_seconds: 0,
            online_sessions: 0,
            offline_sessions: 0,
            uptime_percentage: 0,
            sessions: [],
          };
        }

        if (record.status === "online") {
          analytics[tid].total_online_seconds += record.duration_seconds || 0;
          analytics[tid].online_sessions++;
        } else {
          analytics[tid].total_offline_seconds += record.duration_seconds || 0;
          analytics[tid].offline_sessions++;
        }

        analytics[tid].sessions.push({
          status: record.status,
          changed_at: record.status_changed_at,
          duration_seconds: record.duration_seconds,
          reason: record.reason,
        });
      });

      // Calculate uptime percentages
      Object.values(analytics).forEach((terminal) => {
        const totalSeconds =
          terminal.total_online_seconds + terminal.total_offline_seconds;
        terminal.uptime_percentage =
          totalSeconds > 0
            ? Math.round(
                (terminal.total_online_seconds / totalSeconds) * 100 * 100
              ) / 100
            : 0;

        // Convert seconds to hours for readability
        terminal.total_online_hours =
          Math.round((terminal.total_online_seconds / 3600) * 100) / 100;
        terminal.total_offline_hours =
          Math.round((terminal.total_offline_seconds / 3600) * 100) / 100;
      });

      return {
        period: { startDate, endDate },
        terminals: Object.values(analytics),
        total_terminals: Object.keys(analytics).length,
      };
    } catch (error) {
      console.error(`Error getting uptime analytics:`, error.message);
      throw error;
    }
  }

  // ========== MEDIA SERVICE ==========

  /**
   * Fetch media data from ColorLight media endpoint for a specific program
   * @param {number} programId - The program ID to fetch media for
   * @returns {Promise<Array>} - Array of media objects with thumbnail URLs
   */
  async fetchMediaByProgramId(programId) {
    try {
      const { AUTH_HEADER } = require("../utils");
      const axios = require("axios");

      const mediaUrl = "https://us33.colorlightcloud.com/wp-json/wp/v2/media";

      const response = await axios.get(mediaUrl, {
        ...AUTH_HEADER,
        params: {
          page: 1,
          per_page: 50, // Get more results to ensure we find the program
          flag: "filter",
        },
      });

      if (!response.data || !Array.isArray(response.data)) {
        console.warn(`No media data found for program ${programId}`);
        return [];
      }

      // Filter media by program_id in attachment_program
      const programMedia = response.data.filter((media) => {
        if (
          !media.attachment_program ||
          !Array.isArray(media.attachment_program)
        ) {
          return false;
        }
        return media.attachment_program.some(
          (program) => program.id === programId
        );
      });

      // Map to our program files format
      const programFiles = programMedia
        .filter((media) => {
          // Only include PNG files
          return (
            media.mime_type === "image/png" &&
            media.media_details?.sizes?.thumbnail?.source_url
          );
        })
        .map((media) => ({
          name: media.name,
          total: media.attachment_filesize || 0,
          programId: programId,
          downloaded: media.attachment_filesize || 0,
          thumbnail_url: media.media_details.sizes.thumbnail.source_url,
          full_url: media.source_url,
          media_id: media.id,
          title: media.title?.rendered || media.title_raw || media.name,
        }));

      console.log(
        `📸 Found ${programFiles.length} media files for program ${programId}`
      );
      return programFiles;
    } catch (error) {
      console.error(
        `Error fetching media for program ${programId}:`,
        error.message
      );
      return [];
    }
  }

  // ========== GPS POINTS (terminal_gps_data) ==========

  /**
   * Insert multiple GPS points for a terminal and data_date
   * @param {Array<{ terminal_id: string, data_date: string, longitude: number, latitude: number }>} rows
   * @returns {Promise<Array>} Inserted rows
   */
  async insertTerminalGpsPoints(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("terminal_gps_data")
      .insert(rows)
      .select();

    if (error) {
      throw new Error(`Failed to insert terminal_gps_data: ${error.message}`);
    }
    return data || [];
  }
}

module.exports = new DatabaseService();
