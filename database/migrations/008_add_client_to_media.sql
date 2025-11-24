-- Add client_id to files table for Share of Voice calculation
-- This enables tracking which files belong to which client

-- Step 1: Add client_id column to existing files table
ALTER TABLE files 
ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES client(id) ON DELETE SET NULL;

-- Step 2: Create index for performance
CREATE INDEX IF NOT EXISTS idx_files_client_id ON files(client_id);

-- Step 3: Create composite index for share of voice queries (program_id, client_id)
CREATE INDEX IF NOT EXISTS idx_files_program_client ON files(program_id, client_id);

-- Step 4: Add comment for documentation
COMMENT ON COLUMN files.client_id IS 'Client who owns this file. Used for Share of Voice calculation in co-op advertising where multiple clients share a program.';

-- Note: You'll need to populate client_id for existing files
-- To set client_id for files based on their program's campaign:
--
-- UPDATE files 
-- SET client_id = (
--   SELECT c.client_id 
--   FROM campaign c 
--   WHERE c.program_id = files.program_id 
--   LIMIT 1
-- )
-- WHERE client_id IS NULL;

