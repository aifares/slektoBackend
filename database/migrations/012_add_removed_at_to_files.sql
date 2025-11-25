-- Add removed_at timestamp to files table for soft deletion and Share of Voice tracking
-- This enables accurate historical Share of Voice calculation when files are removed from programs
-- When a campaign completes, files are marked as removed (not deleted) for historical tracking

-- Step 1: Add removed_at column
ALTER TABLE files
ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ DEFAULT NULL;

-- Step 2: Add indexes for performance
-- Index for active files queries (WHERE removed_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_files_program_not_removed 
  ON files(program_id, removed_at) 
  WHERE removed_at IS NULL;

-- Index for share of voice queries (program + client + removal status)
CREATE INDEX IF NOT EXISTS idx_files_program_client_removed 
  ON files(program_id, client_id, removed_at);

-- Index for removed files queries (historical lookups)
CREATE INDEX IF NOT EXISTS idx_files_removed_at 
  ON files(removed_at) 
  WHERE removed_at IS NOT NULL;

-- Step 3: Add comment for documentation
COMMENT ON COLUMN files.removed_at IS 
  'Timestamp when file was removed from the program. NULL = currently active in program. Used for Share of Voice calculation to track when files enter/exit programs during co-op campaigns.';

-- Step 4: Verify the change
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'files' 
    AND column_name = 'removed_at'
  ) THEN
    RAISE NOTICE '✅ removed_at column added successfully';
  ELSE
    RAISE EXCEPTION '❌ Failed to add removed_at column';
  END IF;
END $$;

