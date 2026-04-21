-- ==========================================================
-- Migration 028: Multi-playlist campaigns
-- ==========================================================
-- Adds campaign.mode ('rotation' | 'split') and a campaign_playlists
-- child table that carries per-playlist program_id, bags_assigned,
-- hours_bought, and completed_at.
--
-- Rotation: one campaign_playlists row per campaign (today's behavior).
-- Split:    N rows, each bound to its own ColorLight program.
--
-- campaign.program_id / bags_bought / hours_bought are kept as rollup
-- mirrors for backwards compatibility with existing readers. New code
-- should read from campaign_playlists.
-- ==========================================================

-- ── 1. Campaign mode ──
ALTER TABLE campaign
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'rotation';

ALTER TABLE campaign
  DROP CONSTRAINT IF EXISTS campaign_mode_check;

ALTER TABLE campaign
  ADD CONSTRAINT campaign_mode_check
  CHECK (mode IN ('rotation', 'split'));

-- ── 2. campaign_playlists table ──
CREATE TABLE IF NOT EXISTS campaign_playlists (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  program_id BIGINT NOT NULL REFERENCES programs(id),
  label TEXT,                                  -- optional human label (e.g. "Brand", "Promo")
  bags_assigned INTEGER NOT NULL,              -- bag slots allocated to this playlist
  hours_bought NUMERIC NOT NULL,               -- playback hours purchased for this playlist
  completed_at TIMESTAMPTZ,                    -- when this specific playlist finished
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_playlists_campaign_id
  ON campaign_playlists(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_playlists_program_id
  ON campaign_playlists(program_id);
CREATE INDEX IF NOT EXISTS idx_campaign_playlists_active
  ON campaign_playlists(campaign_id) WHERE completed_at IS NULL;

-- ── 3. Backfill: one row per existing campaign ──
-- Every current campaign has exactly one program_id / bags_bought / hours_bought,
-- so we insert it as a single "rotation" playlist. Skip any campaigns already
-- migrated (idempotent re-run).
INSERT INTO campaign_playlists (campaign_id, program_id, bags_assigned, hours_bought, completed_at, created_at)
SELECT
  c.id,
  c.program_id,
  COALESCE(c.bags_bought, 0),
  c.hours_bought,
  c.completed_at,
  c.created_at
FROM campaign c
WHERE c.program_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM campaign_playlists cp WHERE cp.campaign_id = c.id
  );
