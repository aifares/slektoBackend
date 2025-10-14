-- Migration: Add Impression Analytics Tables
-- Created: 2025-10-13
-- Description: Adds NYC zones, campaign impressions tracking, and zone_id to GPS data

-- Add zone_id column to terminal_gps_data if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'terminal_gps_data' AND column_name = 'zone_id'
    ) THEN
        ALTER TABLE terminal_gps_data ADD COLUMN zone_id BIGINT;
    END IF;
END $$;

-- Create NYC Zones table
CREATE TABLE IF NOT EXISTS nyc_zones (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  zone_type TEXT NOT NULL CHECK (zone_type IN ('tourist', 'shopping', 'residential', 'mixed')),
  min_latitude DOUBLE PRECISION NOT NULL,
  max_latitude DOUBLE PRECISION NOT NULL,
  min_longitude DOUBLE PRECISION NOT NULL,
  max_longitude DOUBLE PRECISION NOT NULL,
  density_multiplier NUMERIC(4,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create Campaign Impressions table
CREATE TABLE IF NOT EXISTS campaign_impressions (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT REFERENCES campaign(id) ON DELETE CASCADE,
  zone_id BIGINT REFERENCES nyc_zones(id),
  terminal_id TEXT REFERENCES terminals(terminalId),
  time_window TIMESTAMPTZ NOT NULL,
  minutes_active NUMERIC(10,2) NOT NULL,
  impressions_count INTEGER NOT NULL,
  gps_points_processed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_terminal_gps_data_zone_date ON terminal_gps_data(zone_id, data_date);
CREATE INDEX IF NOT EXISTS idx_nyc_zones_name ON nyc_zones(name);
CREATE INDEX IF NOT EXISTS idx_nyc_zones_type ON nyc_zones(zone_type);
CREATE INDEX IF NOT EXISTS idx_campaign_impressions_campaign_window ON campaign_impressions(campaign_id, time_window);
CREATE INDEX IF NOT EXISTS idx_campaign_impressions_zone_window ON campaign_impressions(zone_id, time_window);
CREATE INDEX IF NOT EXISTS idx_campaign_impressions_terminal_window ON campaign_impressions(terminal_id, time_window);
CREATE INDEX IF NOT EXISTS idx_campaign_impressions_time_window ON campaign_impressions(time_window);

-- Seed NYC zones data
INSERT INTO nyc_zones (name, display_name, zone_type, min_latitude, max_latitude, min_longitude, max_longitude, density_multiplier) VALUES
  ('times-square', 'Times Square', 'tourist', 40.7550, 40.7600, -73.9880, -73.9840, 10.00),
  ('midtown', 'Midtown', 'tourist', 40.7500, 40.7650, -73.9900, -73.9700, 7.00),
  ('soho', 'Soho', 'shopping', 40.7196, 40.7280, -74.0089, -73.9950, 3.00),
  ('chelsea', 'Chelsea', 'shopping', 40.7420, 40.7530, -74.0070, -73.9920, 2.50),
  ('chinatown', 'Chinatown', 'shopping', 40.7140, 40.7200, -74.0080, -73.9950, 2.00),
  ('fidi', 'Financial District', 'mixed', 40.7010, 40.7130, -74.0180, -74.0070, 2.00),
  ('west-village', 'West Village', 'mixed', 40.7310, 40.7390, -74.0100, -73.9970, 2.00),
  ('east-village', 'East Village', 'mixed', 40.7220, 40.7330, -73.9950, -73.9800, 1.80),
  ('lower-east-side', 'Lower East Side', 'mixed', 40.7140, 40.7240, -73.9950, -73.9800, 1.50),
  ('harlem', 'Harlem', 'residential', 40.7950, 40.8300, -73.9600, -73.9300, 1.20),
  ('upper-east-side', 'Upper East Side', 'residential', 40.7650, 40.7900, -73.9700, -73.9500, 1.00),
  ('upper-west-side', 'Upper West Side', 'residential', 40.7650, 40.7950, -74.0000, -73.9700, 1.00)
ON CONFLICT (name) DO NOTHING;

