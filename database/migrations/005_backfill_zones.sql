-- ======================================================================
-- Backfill Script: Populate zone_id in terminal_status_log
-- ======================================================================
-- This script populates zone_id for existing terminal_status_log records
-- by finding the nearest GPS reading within the status time window.
-- 
-- WARNING: This can be slow on large datasets. Consider running in batches
-- or during off-peak hours.
-- ======================================================================

-- Update terminal_status_log with zone_id from GPS data
-- This finds the closest GPS reading during each status period
UPDATE terminal_status_log tsl
SET zone_id = subquery.zone_id
FROM (
  SELECT DISTINCT ON (tsl_inner.id)
    tsl_inner.id as status_log_id,
    gps.zone_id
  FROM terminal_status_log tsl_inner
  LEFT JOIN terminal_gps_data gps ON (
    gps.terminal_id = tsl_inner.terminal_id
    AND gps.recorded_at >= tsl_inner.status_changed_at
    AND (
      -- If duration_seconds is set, use it to calculate end time
      tsl_inner.duration_seconds IS NULL 
      OR gps.recorded_at <= tsl_inner.status_changed_at + (tsl_inner.duration_seconds || ' seconds')::INTERVAL
    )
  )
  WHERE tsl_inner.zone_id IS NULL  -- Only update rows without zone_id
    AND gps.zone_id IS NOT NULL    -- Only where GPS has a zone
  ORDER BY tsl_inner.id, ABS(EXTRACT(EPOCH FROM (gps.recorded_at - tsl_inner.status_changed_at)))
) AS subquery
WHERE tsl.id = subquery.status_log_id;

-- ======================================================================
-- Verification Query
-- ======================================================================
-- Run this to check how many records were updated:
-- 
-- SELECT 
--   COUNT(*) as total_status_logs,
--   COUNT(zone_id) as with_zone,
--   COUNT(*) - COUNT(zone_id) as without_zone,
--   ROUND(100.0 * COUNT(zone_id) / COUNT(*), 2) as percentage_with_zone
-- FROM terminal_status_log;
-- ======================================================================

