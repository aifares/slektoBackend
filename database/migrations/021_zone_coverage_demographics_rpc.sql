-- ============================================================================
-- Zone Coverage with Demographics RPC Function
-- Combines existing zone coverage with pre-computed demographics
-- Returns all data needed for enhanced exposure scoring
-- ============================================================================

-- Drop existing function if it exists (needed for parameter type change)
DROP FUNCTION IF EXISTS get_zone_coverage_with_demographics(BIGINT[], BIGINT[], TIMESTAMPTZ, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS get_zone_coverage_with_demographics(BIGINT[], TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, INT);

CREATE OR REPLACE FUNCTION get_zone_coverage_with_demographics(
  p_program_ids BIGINT[],
  p_terminal_ids TEXT[],  -- Changed from BIGINT[] to TEXT[]
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_zone_limit INT DEFAULT 50
)
RETURNS TABLE (
  program_id BIGINT,
  program_name TEXT,
  zone_id BIGINT,
  zone_name TEXT,
  display_name TEXT,
  zone_type TEXT,
  density_multiplier NUMERIC,
  
  -- Time metrics (existing - backwards compatible)
  total_minutes NUMERIC,
  total_hours NUMERIC,
  weighted_exposure NUMERIC,
  morning_minutes NUMERIC,
  afternoon_minutes NUMERIC,
  evening_minutes NUMERIC,
  night_minutes NUMERIC,
  rush_hour_minutes NUMERIC,
  
  -- Demographics (NEW)
  residential_demographics JSONB,
  workforce_demographics JSONB,
  tourist_demographics JSONB,
  
  -- Time-based breakdown for demographics calculation (NEW)
  time_period_breakdown JSONB
)
AS $fn$
BEGIN
  RETURN QUERY
  WITH 
  -- Get GPS data with time classification
  gps_classified AS (
    SELECT 
      g.terminal_id,
      g.zone_id::BIGINT as zone_id,
      g.recorded_at,
      g.data_date,
      EXTRACT(HOUR FROM g.recorded_at)::INT as hour,
      EXTRACT(DOW FROM g.recorded_at)::INT as day_of_week,
      
      -- Classify into broad time periods
      CASE
        WHEN EXTRACT(DOW FROM g.recorded_at) BETWEEN 1 AND 5 
             AND EXTRACT(HOUR FROM g.recorded_at) BETWEEN 9 AND 18
          THEN 'weekday_business'
        WHEN EXTRACT(DOW FROM g.recorded_at) BETWEEN 1 AND 5 
             AND EXTRACT(HOUR FROM g.recorded_at) BETWEEN 18 AND 23
          THEN 'weekday_evening'
        WHEN EXTRACT(DOW FROM g.recorded_at) BETWEEN 1 AND 5 
             AND (EXTRACT(HOUR FROM g.recorded_at) < 9 OR EXTRACT(HOUR FROM g.recorded_at) >= 23)
          THEN 'weekday_other'
        WHEN EXTRACT(DOW FROM g.recorded_at) IN (0, 6)
          THEN 'weekend'
        ELSE 'other'
      END as time_period,
      
      -- Also classify for existing time_breakdown (backwards compatibility)
      CASE
        WHEN EXTRACT(HOUR FROM g.recorded_at) BETWEEN 6 AND 11 THEN 'morning'
        WHEN EXTRACT(HOUR FROM g.recorded_at) BETWEEN 12 AND 17 THEN 'afternoon'
        WHEN EXTRACT(HOUR FROM g.recorded_at) BETWEEN 18 AND 22 THEN 'evening'
        ELSE 'night'
      END as time_of_day,
      
      CASE
        WHEN EXTRACT(DOW FROM g.recorded_at) BETWEEN 1 AND 5
             AND EXTRACT(HOUR FROM g.recorded_at) BETWEEN 7 AND 9
          THEN true
        WHEN EXTRACT(DOW FROM g.recorded_at) BETWEEN 1 AND 5
             AND EXTRACT(HOUR FROM g.recorded_at) BETWEEN 17 AND 19
          THEN true
        ELSE false
      END as is_rush_hour
      
    FROM terminal_gps_data g
    WHERE g.terminal_id = ANY(p_terminal_ids)
      AND g.recorded_at >= p_start_date
      AND g.recorded_at <= p_end_date
      AND g.zone_id IS NOT NULL
  ),
  
  -- Get playing sessions for program mapping
  sessions AS (
    SELECT 
      p.program_id,
      p.program_name,
      p.terminal_id,
      p.started_at,
      COALESCE(p.ended_at, NOW()) as ended_at
    FROM playing p
    WHERE p.program_id = ANY(p_program_ids)
      AND p.terminal_id = ANY(p_terminal_ids)
      AND p.started_at <= p_end_date
      AND (p.ended_at IS NULL OR p.ended_at >= p_start_date)
  ),
  
  -- Join GPS with sessions and aggregate by time period
  zone_time_agg AS (
    SELECT 
      s.program_id,
      s.program_name,
      g.zone_id,
      g.time_period,
      g.time_of_day,
      
      -- Count GPS points (each represents ~5 minutes)
      COUNT(*) as gps_points,
      COUNT(*) * 5 as minutes_in_period,
      
      -- Rush hour count
      SUM(CASE WHEN g.is_rush_hour THEN 1 ELSE 0 END) as rush_hour_points
      
    FROM gps_classified g
    JOIN sessions s 
      ON g.terminal_id = s.terminal_id
      AND g.recorded_at >= s.started_at
      AND g.recorded_at <= s.ended_at
    GROUP BY s.program_id, s.program_name, g.zone_id, g.time_period, g.time_of_day
  ),
  
  -- Aggregate by zone
  zone_totals AS (
    SELECT
      zta.program_id,
      zta.program_name,
      zta.zone_id,
      
      -- Total time
      SUM(zta.minutes_in_period) as total_minutes,
      
      -- Time period breakdown (for demographics)
      SUM(CASE WHEN zta.time_period = 'weekday_business' THEN zta.minutes_in_period ELSE 0 END) as weekday_business_min,
      SUM(CASE WHEN zta.time_period = 'weekday_evening' THEN zta.minutes_in_period ELSE 0 END) as weekday_evening_min,
      SUM(CASE WHEN zta.time_period = 'weekend' THEN zta.minutes_in_period ELSE 0 END) as weekend_min,
      SUM(CASE WHEN zta.time_period = 'weekday_other' THEN zta.minutes_in_period ELSE 0 END) as weekday_other_min,
      
      -- Time of day breakdown (existing - backwards compatible)
      SUM(CASE WHEN zta.time_of_day = 'morning' THEN zta.minutes_in_period ELSE 0 END) as morning_min,
      SUM(CASE WHEN zta.time_of_day = 'afternoon' THEN zta.minutes_in_period ELSE 0 END) as afternoon_min,
      SUM(CASE WHEN zta.time_of_day = 'evening' THEN zta.minutes_in_period ELSE 0 END) as evening_min,
      SUM(CASE WHEN zta.time_of_day = 'night' THEN zta.minutes_in_period ELSE 0 END) as night_min,
      
      -- Rush hour
      SUM(zta.rush_hour_points) * 5 as rush_hour_min
      
    FROM zone_time_agg zta
    GROUP BY zta.program_id, zta.program_name, zta.zone_id
  ),
  
  -- Join with zone info and demographics
  final_data AS (
    SELECT
      zt.program_id,
      zt.program_name,
      zt.zone_id,
      z.name as zone_name,
      z.display_name,
      z.zone_type,
      z.density_multiplier,
      
      -- Time metrics
      zt.total_minutes,
      zt.morning_min,
      zt.afternoon_min,
      zt.evening_min,
      zt.night_min,
      zt.rush_hour_min,
      
      -- Time period breakdown
      zt.weekday_business_min,
      zt.weekday_evening_min,
      zt.weekend_min,
      zt.weekday_other_min,
      
      -- Demographics (NULL if not populated yet)
      zd.residential_median_income,
      zd.residential_median_age,
      zd.residential_bachelors_pct,
      zd.residential_population,
      zd.residential_age_dist,
      zd.workforce_median_income,
      zd.workforce_median_age,
      zd.workforce_bachelors_pct,
      zd.workforce_daytime_population,
      zd.workforce_age_dist,
      zd.tourist_profile_type,
      zd.tourist_median_income,
      zd.tourist_median_age,
      zd.tourist_bachelors_pct,
      zd.tourist_age_dist,
      zd.tourist_description,
      zd.data_quality
      
    FROM zone_totals zt
    JOIN nyc_zones z ON zt.zone_id = z.id
    LEFT JOIN zone_demographics zd ON z.id = zd.zone_id
  ),
  
  -- Rank zones by weighted exposure
  ranked AS (
    SELECT
      final_data.*,
      RANK() OVER (
        PARTITION BY final_data.program_id 
        ORDER BY (final_data.total_minutes * final_data.density_multiplier) DESC, final_data.total_minutes DESC
      ) as rank
    FROM final_data
  )
  
  SELECT
    ranked.program_id,
    ranked.program_name,
    ranked.zone_id,
    ranked.zone_name,
    ranked.display_name,
    ranked.zone_type,
    ranked.density_multiplier,
    
    -- Time metrics (backwards compatible)
    ROUND(ranked.total_minutes::numeric, 2) as total_minutes,
    ROUND((ranked.total_minutes / 60.0)::numeric, 2) as total_hours,
    ROUND((ranked.total_minutes * ranked.density_multiplier)::numeric, 2) as weighted_exposure,
    ROUND(ranked.morning_min::numeric, 2) as morning_minutes,
    ROUND(ranked.afternoon_min::numeric, 2) as afternoon_minutes,
    ROUND(ranked.evening_min::numeric, 2) as evening_minutes,
    ROUND(ranked.night_min::numeric, 2) as night_minutes,
    ROUND(ranked.rush_hour_min::numeric, 2) as rush_hour_minutes,
    
    -- Residential demographics as JSONB
    CASE 
      WHEN ranked.residential_median_income IS NOT NULL THEN
        jsonb_build_object(
          'median_income', ranked.residential_median_income,
          'median_age', ranked.residential_median_age,
          'bachelors_pct', ranked.residential_bachelors_pct,
          'population', ranked.residential_population,
          'age_distribution', COALESCE(ranked.residential_age_dist, '{}'::jsonb),
          'data_quality', ranked.data_quality
        )
      ELSE NULL
    END as residential_demographics,
    
    -- Workforce demographics as JSONB
    CASE 
      WHEN ranked.workforce_median_income IS NOT NULL THEN
        jsonb_build_object(
          'median_income', ranked.workforce_median_income,
          'median_age', ranked.workforce_median_age,
          'bachelors_pct', ranked.workforce_bachelors_pct,
          'daytime_population', ranked.workforce_daytime_population,
          'age_distribution', COALESCE(ranked.workforce_age_dist, '{}'::jsonb)
        )
      ELSE NULL
    END as workforce_demographics,
    
    -- Tourist demographics as JSONB
    CASE 
      WHEN ranked.tourist_profile_type IS NOT NULL THEN
        jsonb_build_object(
          'profile_type', ranked.tourist_profile_type,
          'median_income', ranked.tourist_median_income,
          'median_age', ranked.tourist_median_age,
          'bachelors_pct', ranked.tourist_bachelors_pct,
          'age_distribution', COALESCE(ranked.tourist_age_dist, '{}'::jsonb),
          'description', ranked.tourist_description
        )
      ELSE NULL
    END as tourist_demographics,
    
    -- Time period breakdown for demographics calculation
    jsonb_build_object(
      'weekday_business', jsonb_build_object('minutes', ROUND(ranked.weekday_business_min::numeric, 2)),
      'weekday_evening', jsonb_build_object('minutes', ROUND(ranked.weekday_evening_min::numeric, 2)),
      'weekend', jsonb_build_object('minutes', ROUND(ranked.weekend_min::numeric, 2)),
      'other', jsonb_build_object('minutes', ROUND(ranked.weekday_other_min::numeric, 2))
    ) as time_period_breakdown
    
  FROM ranked
  WHERE ranked.rank <= p_zone_limit
  ORDER BY ranked.program_id, ranked.rank;
  
END;
$fn$ LANGUAGE plpgsql STABLE;

-- Add comment
COMMENT ON FUNCTION get_zone_coverage_with_demographics IS 
  'Returns zone coverage with pre-computed demographics for enhanced exposure scoring';


