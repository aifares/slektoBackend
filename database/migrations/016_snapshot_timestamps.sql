-- Migration: Change snapshots from date-based to timestamp-based
-- This enables accurate intra-day tracking of share of voice changes
-- Multiple snapshots per day are now allowed

-- Step 1: Add new timestamp column
ALTER TABLE share_of_voice_snapshots 
ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ;

-- Step 2: Migrate existing data - set timestamp to noon of the snapshot_date
UPDATE share_of_voice_snapshots 
SET snapshot_at = (snapshot_date::timestamp + interval '12 hours')
WHERE snapshot_at IS NULL;

-- Step 3: Make snapshot_at NOT NULL after migration
ALTER TABLE share_of_voice_snapshots 
ALTER COLUMN snapshot_at SET NOT NULL;

-- Step 4: Drop the old unique constraint (allows multiple snapshots per day)
ALTER TABLE share_of_voice_snapshots 
DROP CONSTRAINT IF EXISTS share_of_voice_snapshots_program_id_client_id_snapshot_date_key;

-- Step 5: Create new index for timestamp-based queries
CREATE INDEX IF NOT EXISTS idx_snapshots_program_client_timestamp 
ON share_of_voice_snapshots(program_id, client_id, snapshot_at);

-- Step 6: Add index for efficient range queries
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp 
ON share_of_voice_snapshots(snapshot_at);

-- Step 7: Add comment for documentation
COMMENT ON COLUMN share_of_voice_snapshots.snapshot_at IS 
  'Exact timestamp when this snapshot was taken. Allows multiple snapshots per day for accurate intra-day tracking.';

-- Step 8: Update the RPC function for time-weighted calculation
DROP FUNCTION IF EXISTS public.get_time_weighted_share(BIGINT, BIGINT, TIMESTAMP, TIMESTAMP);

CREATE OR REPLACE FUNCTION public.get_time_weighted_share(
  p_program_id BIGINT,
  p_client_id BIGINT,
  p_start_date TIMESTAMP,
  p_end_date TIMESTAMP
)
RETURNS NUMERIC(5,2)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_result NUMERIC(5,2);
  v_total_weighted_share NUMERIC;
  v_total_duration NUMERIC;
  v_prev_snapshot_at TIMESTAMPTZ;
  v_prev_share NUMERIC;
  v_snapshot RECORD;
BEGIN
  v_total_weighted_share := 0;
  v_total_duration := 0;
  v_prev_snapshot_at := NULL;
  v_prev_share := NULL;

  -- Get all snapshots in range, ordered by time
  FOR v_snapshot IN
    SELECT snapshot_at, share_percent
    FROM share_of_voice_snapshots
    WHERE program_id = p_program_id
      AND client_id = p_client_id
      AND snapshot_at >= p_start_date
      AND snapshot_at <= p_end_date
    ORDER BY snapshot_at ASC
  LOOP
    IF v_prev_snapshot_at IS NOT NULL THEN
      -- Calculate duration from previous snapshot to this one (in minutes)
      DECLARE
        v_duration NUMERIC;
      BEGIN
        v_duration := EXTRACT(EPOCH FROM (v_snapshot.snapshot_at - v_prev_snapshot_at)) / 60.0;
        
        -- Add weighted share for this period
        v_total_weighted_share := v_total_weighted_share + (v_prev_share * v_duration);
        v_total_duration := v_total_duration + v_duration;
      END;
    END IF;
    
    -- Track this snapshot for next iteration
    v_prev_snapshot_at := v_snapshot.snapshot_at;
    v_prev_share := v_snapshot.share_percent;
  END LOOP;

  -- Handle the last period (from last snapshot to end_date)
  IF v_prev_snapshot_at IS NOT NULL AND v_prev_snapshot_at < p_end_date THEN
    DECLARE
      v_duration NUMERIC;
    BEGIN
      v_duration := EXTRACT(EPOCH FROM (p_end_date - v_prev_snapshot_at)) / 60.0;
      v_total_weighted_share := v_total_weighted_share + (v_prev_share * v_duration);
      v_total_duration := v_total_duration + v_duration;
    END;
  END IF;

  -- Handle case where only one snapshot exists
  IF v_total_duration = 0 AND v_prev_share IS NOT NULL THEN
    -- Single snapshot - use its share for the entire period
    RETURN v_prev_share;
  END IF;

  -- Calculate weighted average
  IF v_total_duration > 0 THEN
    v_result := ROUND((v_total_weighted_share / v_total_duration)::NUMERIC, 2);
    RETURN v_result;
  END IF;

  -- No snapshots found
  RETURN NULL;
END;
$fn$;

-- Add comment for the updated function
COMMENT ON FUNCTION public.get_time_weighted_share IS 
  'Calculates true time-weighted average share of voice from timestamped snapshots. Weights each period by its actual duration for accurate intra-day tracking.';

-- Verify migration
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'share_of_voice_snapshots' 
    AND column_name = 'snapshot_at'
  ) THEN
    RAISE NOTICE '✅ snapshot_at column added successfully';
  ELSE
    RAISE EXCEPTION '❌ Failed to add snapshot_at column';
  END IF;
END $$;

