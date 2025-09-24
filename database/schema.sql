-- ==========================================================
-- 📐 Supabase/Postgres Schema for LED Terminal JSON Payload
-- with Driver Support
-- ==========================================================

-- 1. Drivers (people assigned to terminals)
CREATE TABLE IF NOT EXISTS drivers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,                         -- driver's full name
  phone TEXT,                                 -- contact number
  email TEXT,                                 -- optional
  license_number TEXT,                        -- optional: driver's license/ID
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Terminals (device-level info, linked to driver)
CREATE TABLE IF NOT EXISTS terminals (
  terminalId TEXT PRIMARY KEY,                 -- terminal.serialno
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
  terminal_id TEXT REFERENCES terminals(terminalId),  -- link back to terminal
  download_status_time TIMESTAMPTZ,           -- program.downloadstatustime
  files JSONB                                 -- program.files[] stored as JSON
);

-- 4. Files (optional per-file tracking)
CREATE TABLE IF NOT EXISTS files (
  program_id BIGINT REFERENCES programs(id),
  name TEXT,                                  -- file.name
  size BIGINT,                                -- file.size
  downloaded BIGINT,                          -- file.downloaded
  type TEXT,                                  -- file.type
  created_at TIMESTAMPTZ,                     -- file.createtime
  PRIMARY KEY (program_id, name)
);

-- 5. Playing & Recently Played
CREATE TABLE IF NOT EXISTS playing (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT REFERENCES terminals(terminalId),
  program_id BIGINT,                          -- playing.programid
  program_name TEXT,                          -- extracted program name for easy querying
  file_name TEXT,                             -- playing.filename
  source TEXT,                                -- playing.source
  status TEXT DEFAULT 'current' CHECK (status IN ('current', 'completed', 'stopped')), -- playback status
  started_at TIMESTAMPTZ DEFAULT NOW(),       -- derived from rtc.time
  ended_at TIMESTAMPTZ,                       -- when playback ended
  duration_seconds INTEGER                     -- calculated duration (ended_at - started_at)
);

-- 6. Device Status (hardware/software)
CREATE TABLE IF NOT EXISTS device_status (
  terminal_id TEXT PRIMARY KEY REFERENCES terminals(terminalId),
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
  terminal_id TEXT PRIMARY KEY REFERENCES terminals(terminalId),
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
  terminal_id TEXT REFERENCES terminals(terminalId),
  status TEXT NOT NULL CHECK (status IN ('online', 'offline')),
  status_changed_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER,                   -- Duration of previous status
  power_status TEXT,                          -- 'on' or 'off' from terminal
  led_activity_at TIMESTAMPTZ,               -- Last LED activity timestamp
  api_response_at TIMESTAMPTZ,               -- Last API response timestamp
  reason TEXT,                                -- Why status changed ('power_off', 'timeout', 'api_error', 'manual')
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. GPS Points (daily raw locations)
CREATE TABLE IF NOT EXISTS terminal_gps_data (
  id BIGSERIAL PRIMARY KEY,
  terminal_id TEXT REFERENCES terminals(terminalId),
  data_date DATE NOT NULL,                    -- UTC date representing the data window (e.g., 2025-08-15)
  longitude DOUBLE PRECISION NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  inserted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  -- Supabase Auth linkage
  user_id UUID NOT NULL UNIQUE,               -- maps to auth.users.id
  email TEXT NOT NULL UNIQUE,                 -- denormalized for quick lookup
  email_verified BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  -- Account and access control
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','suspended','deleted')),
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

-- 11. Campaigns (each row represents a single campaign)
CREATE TABLE IF NOT EXISTS campaign (
  id BIGSERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES client(id) ON DELETE CASCADE,
  program_id BIGINT REFERENCES programs(id),
  hours_bought NUMERIC(10,2) NOT NULL CHECK (hours_bought >= 0),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (start_at <= end_at)
);

-- ==========================================================
-- 📑 Indexes for Performance
-- ==========================================================

-- Indexes for terminals
CREATE INDEX IF NOT EXISTS idx_terminals_driver_id ON terminals(driver_id);
CREATE INDEX IF NOT EXISTS idx_terminals_group_id ON terminals(group_id);
CREATE INDEX IF NOT EXISTS idx_terminals_last_report_time ON terminals(last_report_time);

-- Indexes for programs
CREATE INDEX IF NOT EXISTS idx_programs_terminal_id ON programs(terminal_id);

-- Indexes for files (primary key already provides index on program_id, name)
-- CREATE INDEX IF NOT EXISTS idx_files_program_id ON files(program_id); -- Not needed with composite PK

-- Indexes for playing
CREATE INDEX IF NOT EXISTS idx_playing_terminal_id ON playing(terminal_id);
CREATE INDEX IF NOT EXISTS idx_playing_started_at ON playing(started_at);
CREATE INDEX IF NOT EXISTS idx_playing_status ON playing(status);
CREATE INDEX IF NOT EXISTS idx_playing_terminal_status ON playing(terminal_id, status); -- composite for efficient queries
CREATE INDEX IF NOT EXISTS idx_playing_program_name ON playing(program_name); -- for program analytics

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

-- Indexes for terminal_gps_data
CREATE INDEX IF NOT EXISTS idx_terminal_gps_data_terminal_date ON terminal_gps_data(terminal_id, data_date);

-- Indexes for client and campaign
CREATE INDEX IF NOT EXISTS idx_client_name ON client(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_user_id ON client(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_email ON client(email);
CREATE INDEX IF NOT EXISTS idx_client_account_status ON client(account_status);
CREATE INDEX IF NOT EXISTS idx_campaign_client_id ON campaign(client_id);
CREATE INDEX IF NOT EXISTS idx_campaign_program_id ON campaign(program_id);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaign(status);
CREATE INDEX IF NOT EXISTS idx_campaign_date_range ON campaign(start_at, end_at);

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
-- 📑 Sample Data (Optional)
-- ==========================================================

-- Insert a sample driver
INSERT INTO drivers (name, phone, email, license_number) 
VALUES ('John Doe', '+1234567890', 'john.doe@example.com', 'DL123456789')
ON CONFLICT DO NOTHING;

-- ==========================================================
-- 📑 Mapping Guide for JSON → DB Inserts
-- ==========================================================
-- drivers:
--   Not present in JSON; assign manually in app or join from external HR/ops system
--   fields: name, phone, email, license_number
--
-- terminals:
--   terminal.* (terminalId=serialno, name, description, authorid, authordisplayname,
--   createtime, onboardingstatus, localecountry, localelanguage, powerstatus,
--   powerstatustime, ledlatesttime)
--   terminalgroup.* (id, name)
--   rtc.time → last_report_time
--   driver_id → foreign key to drivers
--
-- programs:
--   program.id, program.name, program.downloadstatustime, program.files[]
--   link via terminal_id
--
-- files:
--   from program.files[] (name, size, downloaded, type, createtime)
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
