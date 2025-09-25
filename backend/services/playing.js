const { supabase } = require("../config/supabase");

async function upsertPlaying(playingData) {
  const now = new Date().toISOString();

  console.log(
    "🎬 upsertPlaying called with data:",
    JSON.stringify(playingData, null, 2)
  );

  const { data: existingRecords, error: fetchError } = await supabase
    .from("playing")
    .select("*")
    .eq("terminal_id", playingData.terminal_id)
    .eq("status", "current");

  if (fetchError) {
    throw new Error(
      `Failed to fetch existing playing records: ${fetchError.message}`
    );
  }

  if (existingRecords && existingRecords.length > 0) {
    const currentRecord = existingRecords[0];

    if (
      currentRecord.file_name === playingData.file_name &&
      currentRecord.source === playingData.source
    ) {
      console.log(
        `📹 Same content already playing: ${playingData.file_name} (${playingData.program_name})`
      );
      return currentRecord;
    }

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

async function getCurrentlyPlaying(terminalId) {
  const { data, error } = await supabase
    .from("playing")
    .select("*")
    .eq("terminal_id", terminalId)
    .eq("status", "current")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to get currently playing: ${error.message}`);
  }
  return data;
}

async function getRecentlyPlayed(terminalId, limit = 10) {
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

async function getPlaybackHistory(terminalId, recentLimit = 10) {
  const [currentPlaying, recentlyPlayed] = await Promise.all([
    getCurrentlyPlaying(terminalId).catch(() => null),
    getRecentlyPlayed(terminalId, recentLimit),
  ]);

  return {
    current: currentPlaying,
    recent: recentlyPlayed,
    totalRecent: recentlyPlayed.length,
  };
}

async function markCurrentPlayingAsCompleted(terminalId) {
  const now = new Date().toISOString();

  console.log(
    `🔄 Marking current playing records as completed for terminal: ${terminalId}`
  );

  // Get all current playing records for this terminal
  const { data: currentRecords, error: fetchError } = await supabase
    .from("playing")
    .select("*")
    .eq("terminal_id", terminalId)
    .eq("status", "current");

  if (fetchError) {
    throw new Error(
      `Failed to fetch current playing records: ${fetchError.message}`
    );
  }

  if (!currentRecords || currentRecords.length === 0) {
    console.log(
      `📭 No current playing records found for terminal: ${terminalId}`
    );
    return { updated: 0, records: [] };
  }

  const updatedRecords = [];

  // Mark each current record as completed
  for (const record of currentRecords) {
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
        `✅ Marked playing record ${record.id} as completed (${record.file_name}) - duration: ${duration}s`
      );
      updatedRecords.push({
        id: record.id,
        file_name: record.file_name,
        program_name: record.program_name,
        duration_seconds: duration,
      });
    }
  }

  console.log(
    `🎯 Cleaned up ${updatedRecords.length} current playing records for terminal: ${terminalId}`
  );
  return { updated: updatedRecords.length, records: updatedRecords };
}

async function handleTerminalPlayingRecords(terminalData) {
  const { determineOnlineStatus, parseTerminalData } = require("./parser");

  try {
    const { isOnline } = determineOnlineStatus(terminalData);

    if (!isOnline) {
      // Terminal is offline - clean up any current playing records
      console.log(
        `🧹 Terminal ${terminalData.id} is offline - ensuring playing records are cleaned up`
      );

      const cleanupResult = await markCurrentPlayingAsCompleted(
        terminalData.id
      );
      if (cleanupResult.updated > 0) {
        console.log(
          `✅ Cleaned up ${cleanupResult.updated} playing records for offline terminal ${terminalData.id}`
        );
      }
      return cleanupResult;
    } else {
      // Terminal is online - check if content has changed and needs fresh record
      console.log(
        `🔄 Terminal ${terminalData.id} is online - checking for content changes`
      );

      // Check if there's playing data in the terminal response
      const playingData =
        terminalData.post_meta?._led_status?.vsns?.playing ||
        terminalData.post_meta?._led_status?.info?.info?.playing;

      if (playingData && playingData.name) {
        // Get current playing record to compare
        const currentPlaying = await getCurrentlyPlaying(terminalData.id);

        if (currentPlaying) {
          // Check if content has changed
          const parsedData = parseTerminalData(terminalData);
          const contentChanged =
            currentPlaying.file_name !== parsedData.playing?.file_name ||
            currentPlaying.source !== parsedData.playing?.source;

          if (contentChanged) {
            console.log(
              `🔄 Content changed on terminal ${terminalData.id} - closing old record and creating fresh one`
            );
            // Close old record and create fresh one
            await markCurrentPlayingAsCompleted(terminalData.id);
            const freshPlaying = await upsertPlaying(parsedData.playing);
            console.log(
              `🎬 Created fresh playing record for terminal ${terminalData.id}: ${freshPlaying.file_name}`
            );
            return { action: "content_changed", record: freshPlaying };
          } else {
            console.log(
              `📹 Same content still playing on terminal ${terminalData.id}: ${currentPlaying.file_name}`
            );
            return { action: "no_change", record: currentPlaying };
          }
        } else {
          // No current record, create one
          const parsedData = parseTerminalData(terminalData);
          if (parsedData.playing) {
            const freshPlaying = await upsertPlaying(parsedData.playing);
            console.log(
              `🎬 Created new playing record for terminal ${terminalData.id}: ${freshPlaying.file_name}`
            );
            return { action: "new_record", record: freshPlaying };
          }
        }
      }

      return { action: "no_playing_data" };
    }
  } catch (error) {
    console.warn(
      `⚠️ Failed to handle playing records for terminal ${terminalData.id}:`,
      error.message
    );
    throw error;
  }
}

module.exports = {
  upsertPlaying,
  getCurrentlyPlaying,
  getRecentlyPlayed,
  getPlaybackHistory,
  markCurrentPlayingAsCompleted,
  handleTerminalPlayingRecords,
};
