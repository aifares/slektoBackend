const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://jwvywdvpnaachfmkjpji.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("⚠️  SUPABASE_SERVICE_ROLE_KEY not set — admin client creation will fail");
}

// Service role client — bypasses RLS and can create/delete auth users.
// Never expose this key to the frontend.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || "", {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Synthetic email domain for company clients (they log in with username, not email)
const CLIENT_EMAIL_DOMAIN = process.env.CLIENT_EMAIL_DOMAIN || "clients.slekto.com";

function usernameToEmail(username) {
  return `${username.toLowerCase().trim()}@${CLIENT_EMAIL_DOMAIN}`;
}

module.exports = { supabaseAdmin, usernameToEmail, CLIENT_EMAIL_DOMAIN };
