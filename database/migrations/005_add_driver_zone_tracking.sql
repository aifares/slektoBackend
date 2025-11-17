-- ======================================================================
-- Migration 005: Add Driver Zone Tracking
-- ======================================================================
-- This migration adds:
-- 1. zone_id column to terminal_status_log for denormalized zone tracking
-- 2. terminal_driver_assignments table for historical driver assignment tracking
-- 3. Indexes for efficient querying
-- ======================================================================

-- Step 1: Add zone_id column to terminal_status_log (nullable, no foreign key yet)
ALTER TABLE terminal_status_log 
ADD COLUMN IF NOT EXISTS zone_id BIGINT;

-- Step 2: Create terminal_driver_assignments table
CREATE TABLE IF NOT EXISTS terminal_driver_assignments (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES terminals(terminalid),
  driver_id BIGINT NOT NULL REFERENCES drivers(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,                 -- NULL if currently assigned
  assigned_by UUID,                          -- Who made the assignment (from auth.users.id)
  unassigned_by UUID,                        -- Who unassigned (if applicable)
  notes TEXT,                                -- Optional: reason for assignment/swap
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure logical time ordering
  CONSTRAINT check_assignment_times CHECK (
    assigned_at IS NOT NULL AND 
    (unassigned_at IS NULL OR unassigned_at > assigned_at)
  )
);

-- Step 3: Add indexes for terminal_status_log.zone_id
CREATE INDEX IF NOT EXISTS idx_terminal_status_log_zone_id 
  ON terminal_status_log(zone_id);

-- Step 4: Add indexes for terminal_driver_assignments
CREATE INDEX IF NOT EXISTS idx_driver_assignments_terminal 
  ON terminal_driver_assignments(terminal_id);

CREATE INDEX IF NOT EXISTS idx_driver_assignments_driver 
  ON terminal_driver_assignments(driver_id);

CREATE INDEX IF NOT EXISTS idx_driver_assignments_date_range 
  ON terminal_driver_assignments(assigned_at, unassigned_at);

CREATE INDEX IF NOT EXISTS idx_driver_assignments_active 
  ON terminal_driver_assignments(terminal_id, driver_id) 
  WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_driver_assignments_driver_dates 
  ON terminal_driver_assignments(driver_id, assigned_at, unassigned_at);

-- Step 5: Drop existing foreign key constraint if it exists (for idempotency)
ALTER TABLE terminal_status_log
DROP CONSTRAINT IF EXISTS terminal_status_log_zone_id_fkey;

-- Step 6: Clean up any invalid zone references in terminal_status_log
-- Set zone_id to NULL where it references a non-existent zone
UPDATE terminal_status_log
SET zone_id = NULL
WHERE zone_id IS NOT NULL 
  AND zone_id NOT IN (SELECT id FROM nyc_zones);

-- Step 7: Add foreign key constraint (now that invalid references are cleaned)
ALTER TABLE terminal_status_log
ADD CONSTRAINT terminal_status_log_zone_id_fkey 
FOREIGN KEY (zone_id) REFERENCES nyc_zones(id);

-- Step 8: Add comment for terminals.driver_id (deprecated field)
COMMENT ON COLUMN terminals.driver_id IS 'DEPRECATED: Use terminal_driver_assignments table for historical tracking. This field is kept for backwards compatibility but should not be used in new code.';

-- ======================================================================
-- Migration complete
-- 
-- Note: Invalid zone references have been set to NULL. Going forward,
-- only valid zone IDs will be accepted due to the foreign key constraint.
-- ======================================================================

