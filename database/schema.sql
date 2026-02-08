-- ==========================================================
-- 📐 Supabase/Postgres Schema for LED Terminal JSON Payload
-- with Driver Support
-- ==========================================================

-- Ensure PostGIS is available for GEOGRAPHY columns
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Drivers (people assigned to terminals)
CREATE TABLE IF NOT EXISTS drivers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,                         -- driver's full name
  phone TEXT,                                 -- contact number
  email TEXT,                                 -- optional
  license_number TEXT,                        -- optional: driver's license/ID
  address TEXT,                               -- driver's address
  city TEXT,                                  -- driver's city
  state TEXT,                                 -- driver's state
  date_of_birth DATE,                         -- driver's date of birth
  daily_hours NUMERIC,                        -- expected daily hours
  weekly_hours NUMERIC,                       -- expected weekly hours
  submission_date DATE,                       -- when application was submitted
  submission_time TIME,                       -- time of submission
  ip_address TEXT,                            -- IP address at submission
  terms_accepted BOOLEAN DEFAULT FALSE,       -- whether terms were accepted
  terms_accepted_at TIMESTAMPTZ,              -- when terms were accepted
  status TEXT DEFAULT 'pending',              -- driver status (pending, active, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Terminals (device-level info, linked to driver)
CREATE TABLE IF NOT EXISTS terminals (
  terminalid TEXT PRIMARY KEY,                 -- terminal.serialno
  name TEXT NOT NULL,                         -- terminal.name
  description TEXT,                           -- terminal.description
  author_id BIGINT,                           -- terminal.authorid
  author_display_name TEXT,                   -- terminal.authordisplayname
  group_id BIGINT,                            -- terminalgroup.id
  group_name TEXT,                            -- terminalgroup.name
  created_at TIMESTAMPTZ,                     -- terminal.createtime
  onboarding_status TEXT,                     -- terminal.onboardingstatus
  locale_country TEXT,                        -- terminal.localecountry
  locale_language TEXT,                       -- terminal.localelanguage
  power_status TEXT,                          -- terminal.powerstatus
  power_timestamp TIMESTAMPTZ,                -- terminal.powerstatustime
  last_report_time TIMESTAMPTZ,               -- rtc.time
  led_latest_time BIGINT,                     -- terminal.ledlatesttime (Unix timestamp)
  driver_id BIGINT REFERENCES drivers(id)     -- assigned driver
);

-- 3. Programs (playlists)
CREATE TABLE IF NOT EXISTS programs (
  id BIGINT PRIMARY KEY,                      -- program.id
  name TEXT,                                  -- program.name
  thumbnail_url TEXT,                         -- program thumbnail URL
  modified TIMESTAMPTZ,                       -- last modified timestamp
  created TIMESTAMPTZ,                        -- creation timestamp
  status TEXT,                                -- program status
  author_id BIGINT                            -- author ID
);

-- 4. Files (per-file tracking with media metadata)
CREATE TABLE IF NOT EXISTS files (
  id BIGSERIAL PRIMARY KEY,
  program_id BIGINT,                          -- references programs.id
  name TEXT NOT NULL,                         -- file.name
  size BIGINT,                                -- file.size
  downloaded BIGINT,                          -- file.downloaded
  type TEXT,                                  -- file.type
  created_at TIMESTAMPTZ,                     -- file.createtime
  client_id BIGINT,                           -- references client.id
  media_id BIGINT,                            -- external media ID
  source_url TEXT,                            -- original media URL
  title TEXT,                                 -- media title
  custom_tags JSONB,                          -- custom metadata tags
  mime_type TEXT,                             -- MIME type of the file
  file_size_bytes BIGINT,                     -- file size in bytes
  media_width INTEGER,                        -- media width in pixels
  media_height INTEGER,                       -- media height in pixels
  last_synced_at TIMESTAMPTZ,                 -- last sync timestamp
  removed_at TIMESTAMPTZ                      -- soft delete timestamp
);

-- 5. Playing & Recently Played
CREATE TABLE IF NOT EXISTS playing (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT REFERENCES terminals(terminalid),
  program_id BIGINT,                          -- playing.programid
  program_name TEXT,                          -- extracted program name for easy querying
  file_name TEXT,                             -- playing.filename
  source TEXT,                                -- playing.source
  status TEXT DEFAULT 'current',              -- playback status (current, completed, stopped)
  started_at TIMESTAMPTZ DEFAULT NOW(),       -- derived from rtc.time
  ended_at TIMESTAMPTZ,                       -- when playback ended
  duration_seconds INTEGER                     -- calculated duration (ended_at - started_at)
);

-- 6. Device Status (hardware/software)
CREATE TABLE IF NOT EXISTS device_status (
  terminal_id TEXT PRIMARY KEY REFERENCES terminals(terminalid),
  brightness INT,                             -- status.brightness
  colortemperature INT,                       -- status.colortemperature
  volume INT,                                 -- status.volume
  orientation TEXT,                           -- status.orientation
  memory_total BIGINT,                        -- status.memorytotal
  memory_free BIGINT,                         -- status.memoryfree
  storage_total BIGINT,                       -- status.storagetotal
  storage_free BIGINT,                        -- status.storagefree
  model TEXT,                                 -- status.model
  version TEXT,                               -- status.version
  report_time TIMESTAMPTZ                     -- rtc.time
);

-- 7. Connectivity / SIM Info
CREATE TABLE IF NOT EXISTS connectivity (
  terminal_id TEXT PRIMARY KEY REFERENCES terminals(terminalid),
  ip_address TEXT,                            -- status.ip
  mac_address TEXT,                           -- status.mac
  wifi_ssid TEXT,                             -- status.wifiap
  operator_name TEXT,                         -- status.operatorname
  sim_serial TEXT,                            -- status.simserial
  imsi TEXT,                                  -- status.imsi
  deviceid TEXT,                              -- status.deviceid
  netstat TEXT,                               -- status.netstat
  wifi TEXT,                                  -- status.wifi
  lan TEXT,                                   -- status.lan
  fourg TEXT,                                 -- status.fourg
  gps TEXT                                    -- status.gps
);

-- 8. Terminal Status Log (Online/Offline Tracking)
CREATE TABLE IF NOT EXISTS terminal_status_log (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT REFERENCES terminals(terminalid),
  status TEXT NOT NULL,                       -- online, offline
  status_changed_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER,                   -- Duration of previous status
  power_status TEXT,                          -- 'on' or 'off' from terminal
  led_activity_at TIMESTAMPTZ,               -- Last LED activity timestamp
  api_response_at TIMESTAMPTZ,               -- Last API response timestamp
  reason TEXT,                                -- Why status changed ('power_off', 'timeout', 'api_error', 'manual')
  zone_id BIGINT REFERENCES nyc_zones(id),   -- Zone where terminal was located during this status
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8a. Terminal Driver Assignments (Historical tracking of driver assignments)
CREATE TABLE IF NOT EXISTS terminal_driver_assignments (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT NOT NULL REFERENCES terminals(terminalid),
  driver_id BIGINT NOT NULL REFERENCES drivers(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,                 -- NULL if currently assigned
  assigned_by UUID,                          -- Who made the assignment (from auth.users.id)
  unassigned_by UUID,                        -- Who unassigned (if applicable)
  notes TEXT,                                -- Optional: reason for assignment/swap
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. NYC Zones (geographic zones for analytics)
CREATE TABLE IF NOT EXISTS nyc_zones (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  zone_type TEXT NOT NULL,                    -- tourist, shopping, residential, mixed
  min_latitude DOUBLE PRECISION NOT NULL,
  max_latitude DOUBLE PRECISION NOT NULL,
  min_longitude DOUBLE PRECISION NOT NULL,
  max_longitude DOUBLE PRECISION NOT NULL,
  density_multiplier NUMERIC NOT NULL,
  borough TEXT,
  borough_code TEXT,
  boundary GEOGRAPHY(Polygon,4326),           -- PostGIS geography type for spatial queries
  geometry JSONB,                             -- JSON representation of zone boundaries
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. GPS Points (daily raw locations)
CREATE TABLE IF NOT EXISTS terminal_gps_data (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT REFERENCES terminals(terminalid),
  data_date DATE NOT NULL,                    -- UTC date representing the data window (e.g., 2025-08-15)
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ,                    -- Actual GPS recording time from terminal
  inserted_at TIMESTAMPTZ DEFAULT NOW(),      -- When data was imported to database
  zone_id INTEGER REFERENCES nyc_zones(id),   -- References nyc_zones.id, detected during polling
  impressions INTEGER DEFAULT 0,              -- Number of impressions at this GPS point
  quality_weighted_impressions DOUBLE PRECISION DEFAULT 0 -- Quality-weighted impression count
);

-- 11. Client (users/customers)
CREATE TABLE IF NOT EXISTS client (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  -- Supabase Auth linkage
  user_id UUID NOT NULL UNIQUE,               -- maps to auth.users.id
  email TEXT NOT NULL UNIQUE,                 -- denormalized for quick lookup
  email_verified BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  -- Account and access control
  account_status TEXT NOT NULL DEFAULT 'active', -- active, suspended, deleted
  role TEXT NOT NULL DEFAULT 'user',
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  -- Audit fields
  created_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Campaigns (each row represents a single campaign)
CREATE TABLE IF NOT EXISTS campaign (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES client(id) ON DELETE CASCADE,
  program_id BIGINT REFERENCES programs(id),
  hours_bought NUMERIC NOT NULL,
  bags_bought INTEGER,                        -- number of bags/placements purchased
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',     -- planned, active, paused, completed, cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ                    -- when campaign was completed
);

-- 13. Playlist Schedule (pre-computed playlist transitions)
CREATE TABLE IF NOT EXISTS playlist_schedule (
  id BIGSERIAL PRIMARY KEY,
  program_id BIGINT NOT NULL REFERENCES programs(id),
  campaign_id BIGINT NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
  transition_type TEXT NOT NULL,              -- 'campaign_complete' or 'campaign_cancel'
  playlist_state JSONB NOT NULL,             -- Pre-built ColorLight payload to PUT
  remaining_client_ids JSONB NOT NULL,       -- Array of client_ids still active after transition
  applied BOOLEAN DEFAULT FALSE,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Job Locks (for distributed job coordination)
CREATE TABLE IF NOT EXISTS job_locks (
  job_name TEXT PRIMARY KEY,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  machine_id TEXT NOT NULL
);

-- 14. Share of Voice Snapshots (daily tracking of client's share in programs)
CREATE TABLE IF NOT EXISTS share_of_voice_snapshots (
  id BIGSERIAL PRIMARY KEY,
  program_id BIGINT NOT NULL,
  client_id BIGINT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_files_in_program INTEGER NOT NULL DEFAULT 0,
  share_percent NUMERIC NOT NULL DEFAULT 0.00,
  snapshot_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================================
-- 📑 Indexes for Performance
-- ==========================================================

-- Indexes for terminals
CREATE INDEX IF NOT EXISTS idx_terminals_driver_id ON terminals(driver_id);
CREATE INDEX IF NOT EXISTS idx_terminals_group_id ON terminals(group_id);
CREATE INDEX IF NOT EXISTS idx_terminals_last_report_time ON terminals(last_report_time);

-- Indexes for programs
CREATE INDEX IF NOT EXISTS idx_programs_author_id ON programs(author_id);

-- Indexes for files
CREATE INDEX IF NOT EXISTS idx_files_program_id ON files(program_id);
CREATE INDEX IF NOT EXISTS idx_files_client_id ON files(client_id);
CREATE INDEX IF NOT EXISTS idx_files_media_id ON files(media_id);

-- Indexes for playing
CREATE INDEX IF NOT EXISTS idx_playing_terminal_id ON playing(terminal_id);
CREATE INDEX IF NOT EXISTS idx_playing_started_at ON playing(started_at);
CREATE INDEX IF NOT EXISTS idx_playing_status ON playing(status);
CREATE INDEX IF NOT EXISTS idx_playing_terminal_status ON playing(terminal_id, status); -- composite for efficient queries
CREATE INDEX IF NOT EXISTS idx_playing_program_name ON playing(program_name); -- for program analytics
CREATE INDEX IF NOT EXISTS idx_playing_program_id ON playing(program_id);

-- Indexes for device_status (terminal_id already indexed as PRIMARY KEY)
CREATE INDEX IF NOT EXISTS idx_device_status_report_time ON device_status(report_time);

-- Indexes for connectivity (terminal_id already indexed as PRIMARY KEY)
-- No additional indexes needed for connectivity

-- Indexes for terminal_status_log
CREATE INDEX IF NOT EXISTS idx_terminal_status_log_terminal_id ON terminal_status_log(terminal_id);
CREATE INDEX IF NOT EXISTS idx_terminal_status_log_status ON terminal_status_log(status);
CREATE INDEX IF NOT EXISTS idx_terminal_status_log_changed_at ON terminal_status_log(status_changed_at);
CREATE INDEX IF NOT EXISTS idx_terminal_status_log_terminal_status ON terminal_status_log(terminal_id, status);
CREATE INDEX IF NOT EXISTS idx_terminal_status_log_date_range ON terminal_status_log(status_changed_at, terminal_id);
CREATE INDEX IF NOT EXISTS idx_terminal_status_log_zone_id ON terminal_status_log(zone_id);

-- Indexes for terminal_driver_assignments
CREATE INDEX IF NOT EXISTS idx_driver_assignments_terminal ON terminal_driver_assignments(terminal_id);
CREATE INDEX IF NOT EXISTS idx_driver_assignments_driver ON terminal_driver_assignments(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_assignments_date_range ON terminal_driver_assignments(assigned_at, unassigned_at);
CREATE INDEX IF NOT EXISTS idx_driver_assignments_active ON terminal_driver_assignments(terminal_id, driver_id) WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_driver_assignments_driver_dates ON terminal_driver_assignments(driver_id, assigned_at, unassigned_at);

-- Indexes for terminal_gps_data
CREATE INDEX IF NOT EXISTS idx_terminal_gps_data_terminal_date ON terminal_gps_data(terminal_id, data_date);
CREATE INDEX IF NOT EXISTS idx_terminal_gps_data_recorded_at ON terminal_gps_data(recorded_at);
CREATE INDEX IF NOT EXISTS idx_terminal_gps_data_terminal_recorded ON terminal_gps_data(terminal_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_terminal_gps_data_zone_date ON terminal_gps_data(zone_id, data_date);
CREATE INDEX IF NOT EXISTS idx_terminal_gps_data_zone_id ON terminal_gps_data(zone_id);

-- Indexes for nyc_zones
CREATE INDEX IF NOT EXISTS idx_nyc_zones_name ON nyc_zones(name);
CREATE INDEX IF NOT EXISTS idx_nyc_zones_type ON nyc_zones(zone_type);
CREATE INDEX IF NOT EXISTS idx_nyc_zones_borough ON nyc_zones(borough);
CREATE INDEX IF NOT EXISTS idx_nyc_zones_borough_code ON nyc_zones(borough_code);
-- GIST index for PostGIS geography boundary column
CREATE INDEX IF NOT EXISTS idx_nyc_zones_boundary ON nyc_zones USING GIST(boundary);

-- Indexes for client
CREATE INDEX IF NOT EXISTS idx_client_name ON client(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_user_id ON client(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_email ON client(email);
CREATE INDEX IF NOT EXISTS idx_client_account_status ON client(account_status);

-- Indexes for campaign
CREATE INDEX IF NOT EXISTS idx_campaign_client_id ON campaign(client_id);
CREATE INDEX IF NOT EXISTS idx_campaign_program_id ON campaign(program_id);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaign(status);
CREATE INDEX IF NOT EXISTS idx_campaign_date_range ON campaign(start_at, end_at);

-- Indexes for playlist_schedule
CREATE INDEX IF NOT EXISTS idx_playlist_schedule_program_id ON playlist_schedule(program_id);
CREATE INDEX IF NOT EXISTS idx_playlist_schedule_campaign_id ON playlist_schedule(campaign_id);
CREATE INDEX IF NOT EXISTS idx_playlist_schedule_applied ON playlist_schedule(applied) WHERE applied = false;

-- Indexes for share_of_voice_snapshots
CREATE INDEX IF NOT EXISTS idx_sov_program_id ON share_of_voice_snapshots(program_id);
CREATE INDEX IF NOT EXISTS idx_sov_client_id ON share_of_voice_snapshots(client_id);
CREATE INDEX IF NOT EXISTS idx_sov_snapshot_date ON share_of_voice_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_sov_program_client_date ON share_of_voice_snapshots(program_id, client_id, snapshot_date);

-- Indexes for drivers
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_email ON drivers(email);

-- ==========================================================
-- 📑 Row Level Security (RLS) - Optional
-- ==========================================================

-- Enable RLS on all tables (uncomment if needed)
-- ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE files ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE playing ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE device_status ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE connectivity ENABLE ROW LEVEL SECURITY;

-- Example RLS policies (uncomment and modify as needed)
-- CREATE POLICY "Enable read access for all users" ON terminals FOR SELECT USING (true);
-- CREATE POLICY "Enable insert for authenticated users only" ON terminals FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ==========================================================
-- 📑 Mapping Guide for JSON → DB Inserts
-- ==========================================================
-- drivers:
--   Not present in JSON; assign manually in app or join from external HR/ops system
--   fields: name, phone, email, license_number, address, city, state, etc.
--
-- terminals:
--   terminal.* (terminalid=serialno, name, description, authorid, authordisplayname,
--   createtime, onboardingstatus, localecountry, localelanguage, powerstatus,
--   powerstatustime, ledlatesttime)
--   terminalgroup.* (id, name)
--   rtc.time → last_report_time
--   driver_id → foreign key to drivers
--
-- programs:
--   program.id, program.name, thumbnail_url, modified, created, status, author_id
--
-- files:
--   from program.files[] (name, size, downloaded, type, createtime)
--   plus media metadata: client_id, media_id, source_url, title, custom_tags, etc.
--
-- playing:
--   playing.programid, playing.filename, playing.source
--   rtc.time → started_at
--   status: 'current' for actively playing, 'completed'/'stopped' for recently played
--   ended_at: set when playback ends (when new file starts or terminal stops)
--   duration_seconds: calculated as EXTRACT(EPOCH FROM (ended_at - started_at))
--
-- device_status:
--   status.brightness, status.colortemperature, status.volume, status.orientation,
--   status.memorytotal, status.memoryfree, status.storagetotal, status.storagefree,
--   status.model, status.version
--   rtc.time → report_time
--
-- connectivity:
--   status.ip, status.mac, status.wifiap, status.operatorname,
--   status.simserial, status.imsi, status.deviceid,
--   status.netstat, status.wifi, status.lan, status.fourg, status.gps
