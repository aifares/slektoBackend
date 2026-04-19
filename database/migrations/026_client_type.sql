-- Add client type (agency = self-registered, company = admin-created)
ALTER TABLE client ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'agency'
  CHECK (client_type IN ('agency', 'company'));

-- Username for company clients (used instead of email to log in)
ALTER TABLE client ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- Make email + user_id nullable so admin-provisioned accounts don't need them upfront
-- (Supabase always provides both, but this avoids constraint issues during creation)
ALTER TABLE client ALTER COLUMN email DROP NOT NULL;
ALTER TABLE client ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_username ON client(username);
CREATE INDEX IF NOT EXISTS idx_client_type ON client(client_type);
