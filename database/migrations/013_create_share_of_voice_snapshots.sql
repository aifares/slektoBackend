-- Create share_of_voice_snapshots table for daily tracking of file distribution
-- This enables accurate historical Share of Voice calculation when files change mid-campaign
-- Snapshots are taken nightly at 2 AM by the snapshot_share_of_voice cron job

-- Step 1: Create the snapshots table
CREATE TABLE IF NOT EXISTS share_of_voice_snapshots (
  id BIGSERIAL PRIMARY KEY,
  program_id BIGINT NOT NULL,
  client_id BIGINT NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  file_count INT NOT NULL DEFAULT 0,
  total_files_in_program INT NOT NULL DEFAULT 0,
  share_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure one snapshot per program per client per day
  UNIQUE(program_id, client_id, snapshot_date)
);

-- Step 2: Create indexes for performance
-- Index for querying snapshots by program and date range
CREATE INDEX IF NOT EXISTS idx_snapshots_program_date 
  ON share_of_voice_snapshots(program_id, snapshot_date);

-- Index for querying specific client snapshots
CREATE INDEX IF NOT EXISTS idx_snapshots_program_client_date 
  ON share_of_voice_snapshots(program_id, client_id, snapshot_date);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_snapshots_date 
  ON share_of_voice_snapshots(snapshot_date);

-- Step 3: Add comments for documentation
COMMENT ON TABLE share_of_voice_snapshots IS 
  'Daily snapshots of file distribution per program for Share of Voice calculation. Enables accurate historical tracking when files are added/removed during campaigns. Populated by nightly cron job at 2 AM.';

COMMENT ON COLUMN share_of_voice_snapshots.file_count IS 
  'Number of files this client had in the program on this date';

COMMENT ON COLUMN share_of_voice_snapshots.total_files_in_program IS 
  'Total number of files in the program on this date (all clients combined)';

COMMENT ON COLUMN share_of_voice_snapshots.share_percent IS 
  'Calculated share percentage: (file_count / total_files_in_program) * 100';

COMMENT ON COLUMN share_of_voice_snapshots.snapshot_date IS 
  'Date this snapshot represents (DATE only, not timestamp). Snapshots are taken at 2 AM for the previous day.';

-- Step 4: Verify the table was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.tables 
    WHERE table_name = 'share_of_voice_snapshots'
  ) THEN
    RAISE NOTICE '✅ share_of_voice_snapshots table created successfully';
  ELSE
    RAISE EXCEPTION '❌ Failed to create share_of_voice_snapshots table';
  END IF;
END $$;

