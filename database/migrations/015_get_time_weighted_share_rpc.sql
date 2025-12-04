-- Time-Weighted Share of Voice Calculator RPC
-- Calculates average share percentage from daily snapshots for a date range
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
  WITH date_range AS (
    -- Extract date portion from timestamps
    SELECT 
      p_start_date::DATE AS start_date_only,
      p_end_date::DATE AS end_date_only
  ),
  snapshots_in_range AS (
    -- Get all snapshots for this program/client in the date range
    SELECT 
      s.share_percent,
      s.snapshot_date
    FROM share_of_voice_snapshots s
    CROSS JOIN date_range dr
    WHERE s.program_id = p_program_id
      AND s.client_id = p_client_id
      AND s.snapshot_date >= dr.start_date_only
      AND s.snapshot_date <= dr.end_date_only
    ORDER BY s.snapshot_date
  ),
  calculated_avg AS (
    -- Calculate simple average of all snapshots in range
    -- Future enhancement: could weight by actual playtime per day
    SELECT 
      CASE 
        WHEN COUNT(*) > 0 THEN 
          ROUND(AVG(share_percent)::numeric, 2)
        ELSE 
          NULL
      END AS avg_share
    FROM snapshots_in_range
  )
  SELECT avg_share FROM calculated_avg;
$fn$;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_time_weighted_share IS 
  'Calculates time-weighted average share of voice from daily snapshots for a program/client over a date range. Returns NULL if no snapshots exist (signals fallback to current share in application layer).';

