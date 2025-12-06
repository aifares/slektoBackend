-- Time-Weighted Share of Voice Calculator RPC
-- Calculates average share percentage from snapshots for a date range
-- INCLUDES the most recent snapshot BEFORE start_date as the "initial share"
-- Returns NULL if no snapshots exist (signals fallback to current share)
-- More efficient than fetching snapshots in JavaScript and calculating in application layer

DROP FUNCTION IF EXISTS public.get_time_weighted_share(BIGINT, BIGINT, TIMESTAMP, TIMESTAMP);

CREATE OR REPLACE FUNCTION public.get_time_weighted_share(
  p_program_id BIGINT,
  p_client_id BIGINT,
  p_start_date TIMESTAMP,
  p_end_date TIMESTAMP
)
RETURNS NUMERIC(5,2)
LANGUAGE sql
STABLE
AS $fn$
  WITH 
  -- Find the most recent snapshot BEFORE the campaign started
  -- This represents the "initial share" when the campaign began
  pre_start_snapshot AS (
    SELECT 
      s.share_percent,
      COALESCE(s.snapshot_at, s.snapshot_date::timestamptz) AS snapshot_time
    FROM share_of_voice_snapshots s
    WHERE s.program_id = p_program_id
      AND s.client_id = p_client_id
      AND COALESCE(s.snapshot_at, s.snapshot_date::timestamptz) < p_start_date
    ORDER BY COALESCE(s.snapshot_at, s.snapshot_date::timestamptz) DESC
    LIMIT 1
  ),
  -- Get all snapshots during the campaign period
  snapshots_in_range AS (
    SELECT 
      s.share_percent,
      COALESCE(s.snapshot_at, s.snapshot_date::timestamptz) AS snapshot_time
    FROM share_of_voice_snapshots s
    WHERE s.program_id = p_program_id
      AND s.client_id = p_client_id
      AND COALESCE(s.snapshot_at, s.snapshot_date::timestamptz) >= p_start_date
      AND COALESCE(s.snapshot_at, s.snapshot_date::timestamptz) <= p_end_date
  ),
  -- Combine pre-start snapshot with in-range snapshots
  all_relevant_snapshots AS (
    SELECT share_percent, snapshot_time FROM pre_start_snapshot
    UNION ALL
    SELECT share_percent, snapshot_time FROM snapshots_in_range
  ),
  calculated_avg AS (
    -- Calculate simple average of all relevant snapshots
    -- This includes the pre-start snapshot as the initial share
    SELECT 
      CASE 
        WHEN COUNT(*) > 0 THEN 
          ROUND(AVG(share_percent)::numeric, 2)
        ELSE 
          NULL
      END AS avg_share
    FROM all_relevant_snapshots
  )
  SELECT avg_share FROM calculated_avg;
$fn$;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_time_weighted_share IS 
  'Calculates time-weighted average share of voice from snapshots for a program/client over a date range. Includes the most recent snapshot BEFORE start_date as the initial share. Returns NULL if no snapshots exist (signals fallback to current share in application layer).';

