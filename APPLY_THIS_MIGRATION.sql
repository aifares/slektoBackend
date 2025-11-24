-- ============================================================================
-- MEDIA SYNC MIGRATION - Apply this in Supabase SQL Editor
-- ============================================================================
-- This migration adds media metadata columns to the files table
-- Required for ColorLight media sync integration
-- ============================================================================

-- Step 1: Add new columns for media metadata
ALTER TABLE files
ADD COLUMN IF NOT EXISTS media_id BIGINT,                    -- ColorLight's media ID
ADD COLUMN IF NOT EXISTS source_url TEXT,                    -- Full image URL for display
ADD COLUMN IF NOT EXISTS title TEXT,                         -- User-friendly title
ADD COLUMN IF NOT EXISTS custom_tags JSONB,                  -- All tags from ColorLight
ADD COLUMN IF NOT EXISTS mime_type TEXT,                     -- image/png, video/mp4, etc.
ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,             -- Authoritative file size from ColorLight
ADD COLUMN IF NOT EXISTS media_width INT,                    -- Image/video width
ADD COLUMN IF NOT EXISTS media_height INT,                   -- Image/video height
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;         -- When media sync last updated this record

-- Step 2: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_files_media_id ON files(media_id);              -- Lookup by ColorLight media ID
CREATE INDEX IF NOT EXISTS idx_files_name_lookup ON files(name);               -- Fast correlation by filename
CREATE INDEX IF NOT EXISTS idx_files_last_synced ON files(last_synced_at);     -- Track sync freshness
CREATE INDEX IF NOT EXISTS idx_files_custom_tags ON files USING gin(custom_tags); -- Search by tags

-- Step 3: Update existing constraint (if needed)
-- Drop old constraint and create new one that allows same file in multiple programs
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_pkey;
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_program_id_name_key;

-- Add new primary key if id column doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'files' AND column_name = 'id') THEN
    ALTER TABLE files ADD COLUMN id BIGSERIAL PRIMARY KEY;
  END IF;
END $$;

-- Create unique constraint on (program_id, name) to allow same file in multiple programs
CREATE UNIQUE INDEX IF NOT EXISTS files_program_name_unique 
ON files(program_id, name) 
WHERE program_id IS NOT NULL;

-- Create unique index on name alone for files not yet associated with programs
CREATE UNIQUE INDEX IF NOT EXISTS files_name_unique 
ON files(name) 
WHERE program_id IS NULL;

-- Step 4: Add comments for documentation
COMMENT ON COLUMN files.media_id IS 'ColorLight media ID from /wp-json/wp/v2/media endpoint';
COMMENT ON COLUMN files.source_url IS 'Full URL to media file for display in UI';
COMMENT ON COLUMN files.title IS 'User-friendly title from ColorLight (not the encoded filename)';
COMMENT ON COLUMN files.custom_tags IS 'Array of custom tags from ColorLight. Used to extract client_id (format: CompanyName_ClientID)';
COMMENT ON COLUMN files.client_id IS 'Client who owns this file. Extracted from custom_tags during media sync.';
COMMENT ON COLUMN files.mime_type IS 'MIME type from ColorLight (e.g., image/png, video/mp4)';
COMMENT ON COLUMN files.file_size_bytes IS 'Authoritative file size from ColorLight media endpoint';
COMMENT ON COLUMN files.media_width IS 'Media width in pixels (for images and videos)';
COMMENT ON COLUMN files.media_height IS 'Media height in pixels (for images and videos)';
COMMENT ON COLUMN files.last_synced_at IS 'Timestamp when media sync last updated this record. Used to track data freshness.';

-- Step 5: Create function to parse client_id from custom_tags
CREATE OR REPLACE FUNCTION extract_client_id_from_tags(tags JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  tag TEXT;
  client_id_text TEXT;
BEGIN
  -- Loop through tags array
  IF tags IS NOT NULL AND jsonb_array_length(tags) > 0 THEN
    FOR tag IN SELECT jsonb_array_elements_text(tags)
    LOOP
      -- Try to extract number after underscore (e.g., "Lava_1" -> "1")
      client_id_text := substring(tag from '_(\d+)$');
      IF client_id_text IS NOT NULL AND client_id_text ~ '^\d+$' THEN
        RETURN client_id_text::BIGINT;
      END IF;
    END LOOP;
  END IF;
  
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION extract_client_id_from_tags IS 'Extracts client_id from custom_tags JSONB array. Expects format: CompanyName_ClientID (e.g., ["Lava_1"] returns 1)';

