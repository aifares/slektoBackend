const { supabase } = require("../config/supabase");

async function fetchHistoricalTerminals(programIds) {
  const { data: historicalTerminalsData, error: historicalError } =
    await supabase
      .from("playing")
      .select(
        "terminal_id, program_id, program_name, started_at, ended_at, status"
      )
      .in("program_id", programIds)
      .order("started_at", { ascending: true });

  if (historicalError || !historicalTerminalsData) {
    console.warn(
      "Failed to fetch historical terminals data:",
      historicalError?.message
    );
    return [];
  }

  const terminalMap = new Map();

  historicalTerminalsData.forEach((record) => {
    if (!terminalMap.has(record.terminal_id)) {
      terminalMap.set(record.terminal_id, {
        terminal_id: record.terminal_id,
        programs_played: [],
        sessions: [],
        first_played_at: record.started_at,
        last_played_at: record.ended_at || record.started_at,
        is_active: false,
      });
    }

    const terminal = terminalMap.get(record.terminal_id);

    // Track unique programs
    if (!terminal.programs_played.find((p) => p.program_id === record.program_id)) {
      terminal.programs_played.push({
        program_id: record.program_id,
        program_name: record.program_name,
      });
    }

    // Add session entry
    terminal.sessions.push({
      started_at: record.started_at,
      ended_at: record.ended_at || null,
      program_id: record.program_id,
      program_name: record.program_name,
      is_active: record.status === "current",
    });

    // Track is_active — true if any session is currently playing
    if (record.status === "current") {
      terminal.is_active = true;
    }

    // Update first/last timestamps
    if (new Date(record.started_at) < new Date(terminal.first_played_at)) {
      terminal.first_played_at = record.started_at;
    }
    if (record.ended_at && new Date(record.ended_at) > new Date(terminal.last_played_at)) {
      terminal.last_played_at = record.ended_at;
    }
  });

  return Array.from(terminalMap.values());
}

module.exports = { fetchHistoricalTerminals };
