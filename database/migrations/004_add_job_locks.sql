-- ==========================================================
-- Distributed Locking Table for Cron Jobs
-- ==========================================================
-- This table prevents duplicate execution of cron jobs
-- when multiple machines/instances are running.
--
-- Uses unique constraint on job_name to ensure only one
-- instance can acquire a lock at a time.

CREATE TABLE IF NOT EXISTS job_locks (
  job_name TEXT PRIMARY KEY,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id TEXT NOT NULL
);

-- Create index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_job_locks_acquired_at ON job_locks(acquired_at);

-- Add comment for documentation
COMMENT ON TABLE job_locks IS 'Distributed locking table to prevent duplicate cron job execution across multiple instances';

