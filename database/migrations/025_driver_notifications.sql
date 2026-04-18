CREATE TABLE IF NOT EXISTS driver_notifications (
  id        BIGSERIAL PRIMARY KEY,
  -- NULL means broadcast to all drivers; set to a specific driver_id to target one
  driver_id BIGINT REFERENCES drivers(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  body      TEXT NOT NULL,
  sent_via  TEXT CHECK (sent_via IN ('sms', 'in_app', 'both')) DEFAULT 'in_app',
  sent_at   TIMESTAMPTZ DEFAULT NOW(),
  read_at   TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_notifications_driver_id ON driver_notifications(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_notifications_read_at ON driver_notifications(read_at);
