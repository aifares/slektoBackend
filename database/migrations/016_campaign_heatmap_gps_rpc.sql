-- Campaign Heatmap GPS Data RPC
-- Efficiently filters GPS points by campaign start dates and client_id
-- Only returns GPS points from campaigns' start_at onwards, filtered by client's files

DROP FUNCTION IF EXISTS public.get_campaign_heatmap_gps(BIGINT, JSONB, TIMESTAMPTZ, TEXT[]);

CREATE OR REPLACE FUNCTION public.get_campaign_heatmap_gps(
  p_client_id BIGINT,
  p_campaign_programs JSONB,  -- Array of {program_id, campaign_start_at} objects
  p_end_date TIMESTAMPTZ,
  p_terminal_ids TEXT[]
)
RETURNS TABLE (
  terminal_id TEXT,
  program_id BIGINT,
  program_name TEXT,
  longitude DOUBLE PRECISION,
  latitude DOUBLE PRECISION,
  inserted_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $fn$
  WITH campaign_programs AS (
    -- Parse JSONB array into program_id and campaign_start_at pairs
    SELECT 
      (elem->>'program_id')::BIGINT AS program_id,
      (elem->>'campaign_start_at')::TIMESTAMPTZ AS campaign_start_at
    FROM jsonb_array_elements(p_campaign_programs) AS elem
  ),
  filtered_playing AS (
    -- Get playing sessions that:
    -- 1. Match the programs and campaign start dates
    -- 2. Belong to files owned by this client
    -- 3. Started on/after the campaign start date
    SELECT DISTINCT
      pl.terminal_id,
      pl.program_id,
      pl.program_name,
      GREATEST(pl.started_at, cp.campaign_start_at) AS started_at,
      COALESCE(pl.ended_at, p_end_date) AS ended_at
    FROM playing pl
    JOIN campaign_programs cp ON pl.program_id = cp.program_id
    JOIN files f ON f.program_id = pl.program_id 
                AND f.name = pl.file_name
    WHERE f.client_id = p_client_id
      AND f.removed_at IS NULL  -- Only active files
      AND pl.started_at >= cp.campaign_start_at  -- Only sessions from campaign start onwards
      AND pl.started_at <= p_end_date
      AND (p_terminal_ids IS NULL OR pl.terminal_id = ANY(p_terminal_ids))
  ),
  filtered_gps AS (
    -- Get GPS points that:
    -- 1. Match terminals in the filtered playing sessions
    -- 2. Are within the date range (campaign start to end)
    -- Use EXISTS to check if GPS point is within any campaign's date range
    SELECT DISTINCT
      g.terminal_id,
      g.longitude,
      g.latitude,
      g.inserted_at,
      g.recorded_at,
      g.data_date
    FROM terminal_gps_data g
    WHERE (p_terminal_ids IS NULL OR g.terminal_id = ANY(p_terminal_ids))
      AND g.data_date <= DATE(p_end_date)
      AND g.recorded_at <= p_end_date
      AND EXISTS (
        SELECT 1
        FROM campaign_programs cp
        WHERE g.data_date >= DATE(cp.campaign_start_at)
          AND g.recorded_at >= cp.campaign_start_at
      )
  ),
  matched_gps AS (
    -- Match GPS points to playing sessions:
    -- GPS point is only included if there's an active playing session at that time
    SELECT DISTINCT
      fg.terminal_id,
      fp.program_id,
      fp.program_name,
      fg.longitude,
      fg.latitude,
      fg.inserted_at,
      fg.recorded_at
    FROM filtered_gps fg
    JOIN filtered_playing fp 
      ON fp.terminal_id = fg.terminal_id
     AND fg.recorded_at >= fp.started_at
     AND fg.recorded_at < fp.ended_at
  )
  SELECT 
    mg.terminal_id,
    mg.program_id,
    mg.program_name,
    mg.longitude,
    mg.latitude,
    mg.inserted_at,
    mg.recorded_at
  FROM matched_gps mg
  ORDER BY mg.program_id, mg.terminal_id, mg.recorded_at;
$fn$;

-- Indexes to support the function (if not already exist)
CREATE INDEX IF NOT EXISTS idx_playing_program_file_time 
  ON playing(program_id, file_name, started_at, ended_at, terminal_id);

CREATE INDEX IF NOT EXISTS idx_files_program_client_name 
  ON files(program_id, client_id, name) 
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_terminal_gps_recorded_at 
  ON terminal_gps_data(terminal_id, recorded_at, data_date);

-- Add comment for documentation
COMMENT ON FUNCTION public.get_campaign_heatmap_gps IS 
  'Returns GPS points filtered by campaign start dates and client_id. Only includes GPS points from campaign start_at onwards, matched to playing sessions for files owned by the specified client.';

