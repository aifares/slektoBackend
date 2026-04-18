CREATE TABLE IF NOT EXISTS driver_events (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  event_date  TIMESTAMPTZ NOT NULL,
  location    TEXT,
  -- NULL means visible to all drivers; set to a specific driver_id to target one driver
  driver_id   BIGINT REFERENCES drivers(id) ON DELETE CASCADE,
  created_by  UUID,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_events_date ON driver_events(event_date);
CREATE INDEX IF NOT EXISTS idx_driver_events_driver_id ON driver_events(driver_id);
