const { createClient } = require("@supabase/supabase-js");

// Supabase configuration
const SUPABASE_URL = "https://jwvywdvpnaachfmkjpji.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3dnl3ZHZwbmFhY2hmbWtqcGppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgzNDIyMTAsImV4cCI6MjA3MzkxODIxMH0.thX8PBQ07SM8ZsFZiEC2jhaM8xUJvX5BiNjH00HNAoI";

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

module.exports = {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
};
