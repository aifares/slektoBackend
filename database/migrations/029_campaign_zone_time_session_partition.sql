-- ==========================================================
-- Migration 029: Fix get_campaign_zone_time session-boundary bug
-- ==========================================================
-- The previous definition (migration 007) partitioned LEAD() by
-- (program_id, terminal_id, zone_id) only. When a terminal played the
-- same program in the same zone across multiple disjoint playing
-- sessions (e.g. morning + evening), LEAD() would pair the LAST GPS
-- point of one session with the FIRST GPS point of the next session.
-- The resulting multi-hour delta was then clamped to the 30-minute cap,
-- silently adding ~30 phantom minutes of "zone time" per session gap.
--
-- In the worst case this caused `minutes_played_since_campaign_start`
-- to exceed the total playing time of the terminal, making the metric
-- diverge from the zone-coverage RPC (migration 021) which is
-- session-aware by construction.
--
-- Fix:
--   1. Carry the session identity (started_at, ended_at) from
--      filtered_playing through to time_matched.
--   2. Include the session identity in the LEAD() partition so deltas
--      are only computed between GPS points in the SAME session.
--   3. Tighten the per-delta cap from 30 min to 10 min, which is still
--      well above the expected ~5-minute GPS reporting interval but
--      bounds the damage of any intra-session offline window.
-- ==========================================================

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
    -- Clip each playing session to the requested window
    SELECT
      pl.program_id,
      pl.terminal_id,
      GREATEST(pl.started_at, p_start_time) AS session_start,
      LEAST(COALESCE(pl.ended_at, p_end_time), p_end_time) AS session_end
    FROM playing pl
    WHERE pl.program_id = ANY(p_program_ids)
      AND (p_terminal_ids IS NULL OR pl.terminal_id = ANY(p_terminal_ids))
      AND pl.started_at <= p_end_time
      AND COALESCE(pl.ended_at, now()) >= p_start_time
  ),
  gps_in_zones AS (
    -- GPS fixes inside the window that have a zone attached
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
    -- Attribute each GPS fix to the specific playing session it fell within.
    -- Carrying session_start/session_end forward makes LEAD() session-aware.
    SELECT
      fp.program_id,
      fp.terminal_id,
      fp.session_start,
      fp.session_end,
      g.zone_id,
      g.recorded_at
    FROM gps_in_zones g
    JOIN filtered_playing fp
      ON fp.terminal_id = g.terminal_id
     AND g.recorded_at >= fp.session_start
     AND g.recorded_at <  fp.session_end
  ),
  with_deltas AS (
    -- Delta to the NEXT GPS point in the same (program, terminal, zone,
    -- session). This is the critical change: the session partition keys
    -- stop LEAD() from crossing session boundaries.
    SELECT
      tm.program_id,
      tm.terminal_id,
      tm.zone_id,
      tm.recorded_at AS ts,
      LEAD(tm.recorded_at) OVER (
        PARTITION BY tm.program_id,
                     tm.terminal_id,
                     tm.zone_id,
                     tm.session_start,
                     tm.session_end
        ORDER BY tm.recorded_at
      ) AS next_ts
    FROM time_matched tm
  ),
  calculated_deltas AS (
    -- Cap per-delta at 10 minutes so any stray intra-session offline gap
    -- can't inflate the total (GPS is expected every ~5 minutes).
    SELECT
      wd.program_id,
      wd.terminal_id,
      LEAST(
        10.0,
        GREATEST(0.0, EXTRACT(EPOCH FROM (COALESCE(wd.next_ts, wd.ts) - wd.ts)) / 60.0)
      ) AS delta_minutes
    FROM with_deltas wd
  )
  SELECT
    cd.program_id,
    ROUND(SUM(cd.delta_minutes)::numeric, 2) AS total_minutes_in_zones,
    ROUND((SUM(cd.delta_minutes) / 60.0)::numeric, 2) AS total_hours_in_zones,
    COUNT(DISTINCT cd.terminal_id)::int AS terminal_count
  FROM calculated_deltas cd
  GROUP BY cd.program_id;
$fn$;

COMMENT ON FUNCTION public.get_campaign_zone_time IS
  'Session-aware total zone time per program. LEAD() is partitioned by '
  '(program_id, terminal_id, zone_id, session_start, session_end) so gaps '
  'between disjoint playing sessions never contribute phantom minutes. '
  'Intra-session gaps are capped at 10 minutes.';
