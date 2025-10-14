-- Migration: Add Brooklyn Zones
-- Created: 2025-10-13
-- Description: Adds Brooklyn zones to cover delivery bike GPS data

-- Add Brooklyn zones
INSERT INTO nyc_zones (name, display_name, zone_type, min_latitude, max_latitude, min_longitude, max_longitude, density_multiplier) VALUES
  -- South Brooklyn
  ('south-brooklyn', 'South Brooklyn', 'residential', 40.6100, 40.6500, -74.0300, -73.9500, 0.8),
  ('sunset-park', 'Sunset Park', 'mixed', 40.6400, 40.6650, -74.0200, -73.9850, 1.2),
  
  -- Central Brooklyn
  ('park-slope', 'Park Slope', 'residential', 40.6600, 40.6850, -73.9900, -73.9650, 1.5),
  ('prospect-heights', 'Prospect Heights', 'mixed', 40.6750, 40.6900, -73.9750, -73.9550, 1.3),
  ('downtown-brooklyn', 'Downtown Brooklyn', 'shopping', 40.6850, 40.7000, -73.9950, -73.9750, 2.5),
  ('boerum-hill', 'Boerum Hill', 'mixed', 40.6850, 40.6950, -73.9900, -73.9750, 1.4),
  ('fort-greene', 'Fort Greene', 'mixed', 40.6850, 40.6950, -73.9800, -73.9650, 1.4),
  
  -- North Brooklyn
  ('williamsburg', 'Williamsburg', 'shopping', 40.7050, 40.7250, -73.9700, -73.9400, 2.8),
  ('greenpoint', 'Greenpoint', 'mixed', 40.7250, 40.7400, -73.9600, -73.9400, 1.6),
  ('bushwick', 'Bushwick', 'mixed', 40.6950, 40.7150, -73.9400, -73.9100, 1.3),
  
  -- Brooklyn Heights / DUMBO (high traffic)
  ('brooklyn-heights', 'Brooklyn Heights', 'residential', 40.6950, 40.7050, -74.0000, -73.9850, 1.5),
  ('dumbo', 'DUMBO', 'tourist', 40.7000, 40.7100, -73.9950, -73.9850, 3.5),
  
  -- East Brooklyn
  ('bedstuy', 'Bed-Stuy', 'residential', 40.6850, 40.7050, -73.9550, -73.9300, 1.1),
  ('crown-heights', 'Crown Heights', 'residential', 40.6600, 40.6800, -73.9550, -73.9300, 1.0)
ON CONFLICT (name) DO NOTHING;

