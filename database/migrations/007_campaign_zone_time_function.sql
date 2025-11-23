-- Campaign Zone Time Calculator
-- Calculates total minutes played IN ZONES for a campaign/program
-- Uses time-matched GPS data with playing sessions to ensure accurate attribution
-- Handles terminal program switching by matching GPS timestamps to playing sessions

DROP FUNCTION IF EXISTS public.get_campaign_zone_time(BIGINT[], TEXT[], TIMESTAMP, TIMESTAMP);

CREATE OR REPLACE FUNCTION public.get_campaign_zone_time(
  p_program_ids BIGINT[],
  p_terminal_ids TEXT[],
  p_start_time TIMESTAMP,
  p_end_time TIMESTAMP
)
RETURNS TABLE (
  program_id BIGINT,
  total_minutes_in_zones NUMERIC,
  total_hours_in_zones NUMERIC,
  terminal_count INT
)
LANGUAGE sql
STABLE
AS $fn$
  WITH filtered_playing AS (
    -- Get all playing sessions for the programs in the time window
    SELECT 
      pl.program_id,
      pl.terminal_id,
      GREATEST(pl.started_at, p_start_time) AS started_at,
      LEAST(COALESCE(pl.ended_at, p_end_time), p_end_time) AS ended_at
    FROM playing pl
    WHERE pl.program_id = ANY(p_program_ids)
      AND (p_terminal_ids IS NULL OR pl.terminal_id = ANY(p_terminal_ids))
      AND pl.started_at <= p_end_time
      AND COALESCE(pl.ended_at, now()) >= p_start_time
  ),
  gps_in_zones AS (
    -- Get GPS data that has valid zone_id
    SELECT 
      g.terminal_id,
      g.zone_id,
      g.recorded_at
    FROM terminal_gps_data g
    WHERE (p_terminal_ids IS NULL OR g.terminal_id = ANY(p_terminal_ids))
      AND g.recorded_at >= p_start_time
      AND g.recorded_at <= p_end_time
      AND g.zone_id IS NOT NULL
  ),
  time_matched AS (
    -- Join GPS with playing sessions - ensures GPS is only counted when program was playing
    -- This handles terminal switching programs correctly
    SELECT 
      fp.program_id,
      fp.terminal_id,
      g.zone_id,
      g.recorded_at
    FROM gps_in_zones g
    JOIN filtered_playing fp
      ON fp.terminal_id = g.terminal_id
     AND g.recorded_at >= fp.started_at
     AND g.recorded_at <  fp.ended_at
  ),
  with_deltas AS (
    -- Calculate time delta between consecutive GPS points in same zone
    SELECT 
      tm.program_id,
      tm.terminal_id,
      tm.zone_id,
      tm.recorded_at AS ts,
      LEAD(tm.recorded_at) OVER (
        PARTITION BY tm.program_id, tm.terminal_id, tm.zone_id
        ORDER BY tm.recorded_at
      ) AS next_ts
    FROM time_matched tm
  ),
  calculated_deltas AS (
    -- Calculate delta minutes with 30-minute cap
    SELECT 
      wd.program_id,
      wd.terminal_id,
      LEAST(
        30.0,
        GREATEST(0.0, EXTRACT(EPOCH FROM (COALESCE(wd.next_ts, wd.ts) - wd.ts)) / 60.0)
      ) AS delta_minutes
    FROM with_deltas wd
  )
  -- Aggregate per program
  SELECT 
    cd.program_id,
    ROUND(SUM(cd.delta_minutes)::numeric, 2) AS total_minutes_in_zones,
    ROUND((SUM(cd.delta_minutes) / 60.0)::numeric, 2) AS total_hours_in_zones,
    COUNT(DISTINCT cd.terminal_id)::int AS terminal_count
  FROM calculated_deltas cd
  GROUP BY cd.program_id;
$fn$;

-- Index to support the function (if not already exists)
CREATE INDEX IF NOT EXISTS idx_playing_program_terminal_time 
  ON playing(program_id, terminal_id, started_at, ended_at);

CREATE INDEX IF NOT EXISTS idx_terminal_gps_time_zone 
  ON terminal_gps_data(terminal_id, recorded_at, zone_id) 
  WHERE zone_id IS NOT NULL;

