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

module.exports = {
  upsertPlaying,
  getCurrentlyPlaying,
  getRecentlyPlayed,
  getPlaybackHistory,
};
