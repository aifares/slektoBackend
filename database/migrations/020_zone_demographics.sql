-- ============================================================================
-- Zone Demographics Table
-- Stores pre-computed demographic data for each zone from Census API
-- Updated: Once per year when Census releases new data
-- ============================================================================

CREATE TABLE IF NOT EXISTS zone_demographics (
  id BIGSERIAL PRIMARY KEY,
  zone_id BIGINT UNIQUE NOT NULL REFERENCES nyc_zones(id) ON DELETE CASCADE,
  
  -- Census tract identification
  census_tract TEXT,
  census_state TEXT,
  census_county TEXT,
  census_fips TEXT,
  
  -- Residential demographics (from US Census ACS 5-Year)
  residential_median_income INT NOT NULL DEFAULT 0,
  residential_median_age NUMERIC(5,2) NOT NULL DEFAULT 0,
  residential_bachelors_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  residential_population INT NOT NULL DEFAULT 0,
  residential_employment_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  residential_mgmt_prof_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  residential_age_dist JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Workforce demographics (simulated from residential or LODES data)
  workforce_median_income INT NOT NULL DEFAULT 0,
  workforce_median_age NUMERIC(5,2) NOT NULL DEFAULT 0,
  workforce_bachelors_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  workforce_daytime_population INT NOT NULL DEFAULT 0,
  workforce_mgmt_prof_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  workforce_age_dist JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Tourist/Visitor profile (zone-specific from demographics service)
  tourist_profile_type TEXT NOT NULL DEFAULT 'local_visitor',
  tourist_median_income INT NOT NULL DEFAULT 75000,
  tourist_median_age NUMERIC(5,2) NOT NULL DEFAULT 35,
  tourist_bachelors_pct NUMERIC(5,2) NOT NULL DEFAULT 55,
  tourist_age_dist JSONB NOT NULL DEFAULT '{}'::jsonb,
  tourist_description TEXT,
  
  -- Metadata
  data_quality TEXT NOT NULL DEFAULT 'medium',
  data_source TEXT NOT NULL DEFAULT 'census_acs5_2022',
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- GPS coordinates used for Census geocoding
  sample_latitude DOUBLE PRECISION,
  sample_longitude DOUBLE PRECISION,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_zone_demographics_zone_id ON zone_demographics(zone_id);
CREATE INDEX idx_zone_demographics_quality ON zone_demographics(data_quality);
CREATE INDEX idx_zone_demographics_updated ON zone_demographics(last_updated_at);

-- Comments
COMMENT ON TABLE zone_demographics IS 'Pre-computed demographic data per zone from US Census API';
COMMENT ON COLUMN zone_demographics.data_quality IS 'high (Census data), medium (simulated), low (fallback)';
COMMENT ON COLUMN zone_demographics.last_updated_at IS 'Last time demographics were fetched/updated';









