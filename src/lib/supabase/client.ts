import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { reportingFetch } from "../errorReporter";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly at startup rather than producing confusing runtime errors later —
  // see README "Environment setup" for where to get these two values.
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill in your Supabase project's values (Project Settings -> API).",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    // Every request the app makes — PostgREST and GoTrue alike — passes
    // through here, and anything that comes back 4xx/5xx is logged before
    // being handed on untouched. This is how a failure the screen CATCHES
    // ("Could not load your sessions.") reaches the admin console at all: a
    // caught error never sees an error boundary. Response bodies only, never
    // request bodies — those carry passwords. See lib/errorReporter.ts.
    fetch: reportingFetch,
  },
});
