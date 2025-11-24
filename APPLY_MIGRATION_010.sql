-- ============================================================================
-- MAKE program_id NULLABLE - Apply this in Supabase SQL Editor
-- ============================================================================
-- This allows the new flow:
-- 1. Media sync INSERTS files (with client_id, but program_id = NULL)
-- 2. Poller UPDATES files (adds program_id when terminal reports them)
-- ============================================================================

-- Step 1: Drop NOT NULL constraint on program_id
ALTER TABLE files 
ALTER COLUMN program_id DROP NOT NULL;

-- Step 2: Update unique constraints to handle NULL program_id
-- Drop old constraints
DROP INDEX IF EXISTS files_program_name_unique;
DROP INDEX IF EXISTS files_name_unique;

-- Create new unique constraint that allows multiple NULL program_ids for same file
-- But only one non-NULL program_id per file name
CREATE UNIQUE INDEX files_program_name_unique 
ON files(program_id, name) 
WHERE program_id IS NOT NULL;

-- Allow files to exist with NULL program_id (before poller assigns them)
CREATE UNIQUE INDEX files_name_null_program_unique 
ON files(name) 
WHERE program_id IS NULL;

COMMENT ON COLUMN files.program_id IS 'Program ID from terminal data. Added by poller after media sync inserts the file. Can be NULL if file not yet associated with a program.';

