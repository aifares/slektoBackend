CREATE TABLE IF NOT EXISTS driver_pay_periods (
  id          BIGSERIAL PRIMARY KEY,
  driver_id   BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,             -- "YYYY-MM"
  total_hours NUMERIC(8,2) NOT NULL,
  total_pay   NUMERIC(10,2) NOT NULL,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_by     UUID,                      -- admin user_id who marked it paid
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(driver_id, period)
);

CREATE INDEX IF NOT EXISTS idx_driver_pay_periods_driver_id ON driver_pay_periods(driver_id);
