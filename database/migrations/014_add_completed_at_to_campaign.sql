-- Add completed_at column to campaign table
-- This tracks when a campaign was marked as completed

ALTER TABLE campaign
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add index for querying completed campaigns
CREATE INDEX IF NOT EXISTS idx_campaign_completed_at ON campaign(completed_at);

-- Add comment for documentation
COMMENT ON COLUMN campaign.completed_at IS 'Timestamp when the campaign was marked as completed. NULL means the campaign has not been completed yet.';

