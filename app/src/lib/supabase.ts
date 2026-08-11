import { createClient } from "@supabase/supabase-js";

/**
 * Config injection without a bundler (see README.md -- no framework, no
 * bundler, native ES modules only): index.html loads env-config.js
 * (gitignored; env-config.example.js is the checked-in template) as a
 * plain classic script before this module runs, setting
 * window.__DOCSCRUB_ENV__. There is no Vite/webpack define step, so
 * import.meta.env / process.env are not available here.
 *
 * Both values are browser-safe -- the Supabase project URL and the
 * publishable (anon) key are designed to be exposed to frontend code and
 * are protected by Row Level Security, not by secrecy. Never put a
 * service_role key here.
 */
declare global {
  interface Window {
    __DOCSCRUB_ENV__?: {
      SUPABASE_URL?: string;
      SUPABASE_PUBLISHABLE_KEY?: string;
    };
  }
}

const env = window.__DOCSCRUB_ENV__;

if (!env?.SUPABASE_URL || !env?.SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Supabase configuration missing -- copy env-config.example.js to env-config.js and fill in SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY."
  );
}

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
  },
});
