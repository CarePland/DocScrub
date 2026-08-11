// Copy this file to env-config.js (gitignored) and fill in real values.
//
// Both values are browser-safe: the Supabase project URL and the
// publishable (anon) key are meant to be exposed to frontend code and are
// protected by Supabase Row Level Security, not by secrecy. Never put a
// service_role key here.
//
// index.html loads env-config.js before the app module, so this must
// stay a plain classic script (no import/export) that sets a global.
window.__DOCSCRUB_ENV__ = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "YOUR_PUBLISHABLE_OR_ANON_KEY",
};
