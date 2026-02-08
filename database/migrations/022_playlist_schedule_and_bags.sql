-- ==========================================================
-- Migration 022: Add playlist_schedule table and bags_bought to campaign
-- ==========================================================

-- Add bags_bought column to campaign table
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS bags_bought INTEGER;

-- Create playlist_schedule table for pre-computed playlist transitions
CREATE TABLE IF NOT EXISTS playlist_schedule (
  id BIGSERIAL PRIMARY KEY,
  program_id BIGINT NOT NULL REFERENCES programs(id),
  campaign_id BIGINT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  transition_type TEXT NOT NULL,              -- 'campaign_complete' or 'campaign_cancel'
  playlist_state JSONB NOT NULL,             -- Pre-built ColorLight payload to PUT
  remaining_client_ids JSONB NOT NULL,       -- Array of client_ids still active after this transition
  applied BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for playlist_schedule
CREATE INDEX IF NOT EXISTS idx_playlist_schedule_program_id ON playlist_schedule(program_id);
CREATE INDEX IF NOT EXISTS idx_playlist_schedule_campaign_id ON playlist_schedule(campaign_id);
CREATE INDEX IF NOT EXISTS idx_playlist_schedule_applied ON playlist_schedule(applied) WHERE applied = false;
