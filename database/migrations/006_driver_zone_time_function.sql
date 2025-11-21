-- Driver Zone Time Breakdown Function
-- Efficiently calculates time spent in each zone for a driver during a date range

CREATE OR REPLACE FUNCTION get_driver_zone_time_breakdown(
  p_driver_id INTEGER,
  p_start_date TEXT,
  p_end_date TEXT
)
RETURNS TABLE (
  zone_id INTEGER,
  zone_name TEXT,
  zone_display_name TEXT,
  zone_type TEXT,
  borough TEXT,
  online_seconds INTEGER,
  online_hours NUMERIC,
  gps_points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH driver_assignments AS (
    -- Get all terminal assignments for this driver in the date range
    SELECT 
      terminal_id,
      assigned_at,
      COALESCE(unassigned_at, NOW()) as unassigned_at
    FROM terminal_driver_assignments
    WHERE driver_id = p_driver_id
      AND (
        (assigned_at <= (p_end_date || 'T23:59:59')::TIMESTAMP 
         AND COALESCE(unassigned_at, NOW()) >= p_start_date::TIMESTAMP)
        OR
        (assigned_at <= (p_end_date || 'T23:59:59')::TIMESTAMP 
         AND unassigned_at IS NULL)
      )
  ),
  online_sessions AS (
    -- Get all online status logs for assigned terminals
    SELECT 
      tsl.terminal_id,
      tsl.status_changed_at,
      tsl.status_changed_at + (tsl.duration_seconds || ' seconds')::INTERVAL as session_end,
      tsl.duration_seconds
    FROM terminal_status_log tsl
    INNER JOIN driver_assignments da 
      ON tsl.terminal_id = da.terminal_id
    WHERE tsl.status = 'online'
      AND tsl.duration_seconds IS NOT NULL
      AND tsl.status_changed_at >= p_start_date::TIMESTAMP
      AND tsl.status_changed_at <= (p_end_date || 'T23:59:59')::TIMESTAMP
      -- Only include sessions during assignment period
      AND tsl.status_changed_at >= da.assigned_at
      AND tsl.status_changed_at <= da.unassigned_at
  ),
  gps_during_sessions AS (
    -- Get GPS points during online sessions
    SELECT 
      os.terminal_id,
      os.status_changed_at as session_start,
      os.session_end,
      os.duration_seconds,
      gps.zone_id,
      gps.recorded_at,
      -- Calculate average time per GPS point in this session
      os.duration_seconds::NUMERIC / (
        COUNT(*) OVER (PARTITION BY os.terminal_id, os.status_changed_at) + 1
      ) as avg_seconds_per_point
    FROM online_sessions os
    INNER JOIN terminal_gps_data gps
      ON gps.terminal_id = os.terminal_id
      AND gps.recorded_at >= os.status_changed_at
      AND gps.recorded_at <= os.session_end
      AND gps.zone_id IS NOT NULL
  ),
  zone_aggregation AS (
    -- Aggregate by zone
    SELECT 
      gds.zone_id,
      SUM(gds.avg_seconds_per_point)::INTEGER as total_seconds,
      COUNT(*)::INTEGER as point_count
    FROM gps_during_sessions gds
    GROUP BY gds.zone_id
  )
  -- Join with zone details and return
  SELECT 
    za.zone_id,
    COALESCE(z.name, 'Unknown') as zone_name,
    COALESCE(z.display_name, 'Unknown') as zone_display_name,
    z.zone_type,
    z.borough,
    za.total_seconds as online_seconds,
    ROUND((za.total_seconds / 3600.0)::NUMERIC, 2) as online_hours,
    za.point_count as gps_points
  FROM zone_aggregation za
  LEFT JOIN nyc_zones z ON z.id = za.zone_id
  ORDER BY za.total_seconds DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Add comment
COMMENT ON FUNCTION get_driver_zone_time_breakdown(INTEGER, TEXT, TEXT) IS 
'Calculates time spent in each zone for a driver during a date range. Uses database-side aggregation for performance.';

-- Example usage:
-- SELECT * FROM get_driver_zone_time_breakdown(4, '2025-11-01', '2025-11-21');

