-- Migration 014: Add completed_at to campaign table
-- Apply this in Supabase SQL Editor

ALTER TABLE campaign
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaign_completed_at ON campaign(completed_at);

COMMENT ON COLUMN campaign.completed_at IS 'Timestamp when the campaign was marked as completed. NULL means the campaign has not been completed yet.';

