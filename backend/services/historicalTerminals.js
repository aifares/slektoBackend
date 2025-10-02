const { supabase } = require("../config/supabase");

async function fetchHistoricalTerminals(programIds) {
  const { data: historicalTerminalsData, error: historicalError } =
    await supabase
      .from("playing")
      .select(
        "terminal_id, program_id, program_name, started_at, ended_at, status"
      )
      .in("program_id", programIds);

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
        first_played_at: record.started_at,
        last_played_at: record.ended_at || record.started_at,
      });
    }

    const terminal = terminalMap.get(record.terminal_id);

    if (
      !terminal.programs_played.find((p) => p.program_id === record.program_id)
    ) {
      terminal.programs_played.push({
        program_id: record.program_id,
        program_name: record.program_name,
      });
    }

    if (new Date(record.started_at) < new Date(terminal.first_played_at)) {
      terminal.first_played_at = record.started_at;
    }
    if (
      record.ended_at &&
      new Date(record.ended_at) > new Date(terminal.last_played_at)
    ) {
      terminal.last_played_at = record.ended_at;
    }
  });

  return Array.from(terminalMap.values());
}

module.exports = { fetchHistoricalTerminals };
