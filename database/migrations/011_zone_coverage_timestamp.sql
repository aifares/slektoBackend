-- Update zone coverage function to accept timestamps for precise campaign timing
-- This allows zone coverage to start at exact campaign start time (e.g., 03:08 AM)
-- instead of always starting at midnight

DROP FUNCTION IF EXISTS public.get_zone_coverage_topn(BIGINT[], TEXT[], DATE, DATE, INT);

CREATE OR REPLACE FUNCTION public.get_zone_coverage_topn(
  p_program_ids BIGINT[],
  p_terminal_ids TEXT[],
  p_start_date TIMESTAMPTZ,  -- Changed from DATE to TIMESTAMPTZ
  p_end_date TIMESTAMPTZ,     -- Changed from DATE to TIMESTAMPTZ
  p_zone_limit INT
)
RETURNS TABLE (
  program_id BIGINT,
  program_name TEXT,
  zone_id BIGINT,
  zone_name TEXT,
  display_name TEXT,
  zone_type TEXT,
  density_multiplier NUMERIC,
  total_minutes NUMERIC,
  total_hours NUMERIC,
  weighted_exposure NUMERIC,
  morning_minutes NUMERIC,
  afternoon_minutes NUMERIC,
  evening_minutes NUMERIC,
  night_minutes NUMERIC,
  rush_hour_minutes NUMERIC,
  total_zones_available INT,
  date_start TEXT,
  date_end TEXT
)
LANGUAGE SQL
STABLE
AS $fn$
  WITH params AS (
    SELECT 
      CASE WHEN p_zone_limit IS NULL OR p_zone_limit <= 0 THEN 20 ELSE LEAST(p_zone_limit, 50) END AS zone_limit,
      p_start_date::timestamptz AS start_ts,
      p_end_date::timestamptz AS end_ts,
      p_start_date::date AS start_date,  -- Keep date versions for data_date filtering
      p_end_date::date AS end_date
  ),
  zones_count AS (
    SELECT COUNT(*)::int AS total_zones FROM nyc_zones
  ),
  filtered_playing AS (
    SELECT 
      pl.program_id,
      pl.terminal_id,
      COALESCE(pl.program_name, '') AS program_name,
      GREATEST(pl.started_at, (SELECT start_ts FROM params)) AS started_at,
      LEAST(COALESCE(pl.ended_at, (SELECT end_ts FROM params)), (SELECT end_ts FROM params)) AS ended_at
    FROM playing pl
    WHERE pl.program_id = ANY(p_program_ids)
      AND pl.terminal_id = ANY(p_terminal_ids)
      AND pl.started_at <= (SELECT end_ts FROM params)
      AND COALESCE(pl.ended_at, now()) >= (SELECT start_ts FROM params)
  ),
  gps AS (
    SELECT 
      g.terminal_id,
      g.zone_id,
      g.recorded_at
    FROM terminal_gps_data g
    WHERE g.terminal_id = ANY(p_terminal_ids)
      AND g.data_date >= (SELECT start_date FROM params)
      AND g.data_date <= (SELECT end_date FROM params)
      AND g.zone_id IS NOT NULL
  ),
  joined AS (
    SELECT 
      fp.program_id,
      fp.program_name,
      g.terminal_id,
      g.zone_id,
      g.recorded_at
    FROM gps g
    JOIN filtered_playing fp
      ON fp.terminal_id = g.terminal_id
     AND g.recorded_at >= fp.started_at
     AND g.recorded_at <  fp.ended_at
  ),
  seq AS (
    SELECT 
      program_id,
      program_name,
      terminal_id,
      zone_id,
      recorded_at AS ts,
      LEAD(recorded_at) OVER (
        PARTITION BY program_id, terminal_id, zone_id
        ORDER BY recorded_at
      ) AS next_ts
    FROM joined
  ),
  deltas AS (
    SELECT 
      s.program_id,
      s.program_name,
      s.terminal_id,
      s.zone_id,
      s.ts,
      LEAST(
        30.0,
        GREATEST(0.0, EXTRACT(EPOCH FROM (COALESCE(s.next_ts, s.ts) - s.ts)) / 60.0)
      ) AS delta_minutes,
      EXTRACT(HOUR FROM s.ts) AS hour
    FROM seq s
  ),
  agg AS (
    SELECT 
      d.program_id,
      d.program_name,
      d.zone_id,
      SUM(d.delta_minutes) AS total_minutes,
      SUM(CASE WHEN d.hour >= 6 AND d.hour < 12 THEN d.delta_minutes ELSE 0 END) AS morning_minutes,
      SUM(CASE WHEN d.hour >= 12 AND d.hour < 18 THEN d.delta_minutes ELSE 0 END) AS afternoon_minutes,
      SUM(CASE WHEN d.hour >= 18 AND d.hour < 22 THEN d.delta_minutes ELSE 0 END) AS evening_minutes,
      SUM(CASE WHEN d.hour >= 22 OR d.hour < 6 THEN d.delta_minutes ELSE 0 END) AS night_minutes,
      SUM(CASE WHEN (d.hour >= 7 AND d.hour < 10) OR (d.hour >= 16 AND d.hour < 19) THEN d.delta_minutes ELSE 0 END) AS rush_hour_minutes
    FROM deltas d
    GROUP BY d.program_id, d.program_name, d.zone_id
  ),
  ranked AS (
    SELECT 
      a.program_id,
      a.program_name,
      a.zone_id,
      z.name AS zone_name,
      z.display_name,
      z.zone_type,
      z.density_multiplier,
      a.total_minutes,
      a.morning_minutes,
      a.afternoon_minutes,
      a.evening_minutes,
      a.night_minutes,
      a.rush_hour_minutes,
      ROW_NUMBER() OVER (
        PARTITION BY a.program_id 
        ORDER BY (a.total_minutes * z.density_multiplier) DESC
      ) AS rank
    FROM agg a
    JOIN nyc_zones z ON z.id = a.zone_id
  )
  SELECT 
    r.program_id,
    r.program_name,
    r.zone_id,
    r.zone_name,
    r.display_name,
    r.zone_type,
    r.density_multiplier,
    ROUND(r.total_minutes::numeric, 2) AS total_minutes,
    ROUND((r.total_minutes / 60.0)::numeric, 2) AS total_hours,
    ROUND((r.total_minutes * r.density_multiplier)::numeric, 2) AS weighted_exposure,
    ROUND(r.morning_minutes::numeric, 2) AS morning_minutes,
    ROUND(r.afternoon_minutes::numeric, 2) AS afternoon_minutes,
    ROUND(r.evening_minutes::numeric, 2) AS evening_minutes,
    ROUND(r.night_minutes::numeric, 2) AS night_minutes,
    ROUND(r.rush_hour_minutes::numeric, 2) AS rush_hour_minutes,
    (SELECT total_zones FROM zones_count) AS total_zones_available,
    (SELECT start_date::text FROM params) AS date_start,
    (SELECT end_date::text FROM params) AS date_end
  FROM ranked r
  WHERE r.rank <= (SELECT zone_limit FROM params)
  ORDER BY r.program_id, r.rank;
$fn$;

-- Indexes remain the same as before
CREATE INDEX IF NOT EXISTS idx_terminal_gps_data_date_zone 
  ON terminal_gps_data(terminal_id, data_date, zone_id) 
  WHERE zone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playing_program_terminal_dates 
  ON playing(program_id, terminal_id, started_at, ended_at);

