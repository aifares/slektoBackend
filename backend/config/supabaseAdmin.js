const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://jwvywdvpnaachfmkjpji.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("⚠️  SUPABASE_SERVICE_ROLE_KEY not set — admin client creation will fail");
}

// Lazy singleton — only instantiated on first use so a missing key doesn't crash startup.
let _client = null;
function getAdminClient() {
  if (!_client) {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. Add it to your .env or Fly secrets.");
    }
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _client;
}

// Proxy so callers use supabaseAdmin.auth.admin.createUser() as normal
const supabaseAdmin = new Proxy({}, {
  get(_, prop) { return getAdminClient()[prop]; },
});

// Synthetic email domain for company clients (they log in with username, not email)
const CLIENT_EMAIL_DOMAIN = process.env.CLIENT_EMAIL_DOMAIN || "clients.slekto.com";

function usernameToEmail(username) {
  return `${username.toLowerCase().trim()}@${CLIENT_EMAIL_DOMAIN}`;
}

module.exports = { supabaseAdmin, usernameToEmail, CLIENT_EMAIL_DOMAIN };
