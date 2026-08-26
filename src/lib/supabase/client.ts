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
    // PKCE rather than the implicit default.
    //
    // Implicit hands the access token back in the URL fragment, where it can
    // leak through history, logs and referrers. PKCE returns a one-time code
    // that is worthless without a verifier only this client holds.
    //
    // It is also the only flow a native app can complete. Google refuses OAuth
    // inside an app's embedded webview, so sign-in there happens in the system
    // browser and comes back through a deep link — which means exchanging a
    // code, not catching a fragment.
    //
    // This also changes the shape of confirmation and password-reset links
    // (?code= rather than #access_token=). detectSessionInUrl handles both, so
    // no screen changes — but a link already sitting in an inbox when this
    // deploys was minted under the old flow and will not work. Those expire
    // within the hour, which is why this is its own commit: it can be
    // cherry-picked onto main and shipped alone, at a quiet time, rather than
    // riding along with the iOS release where a broken reset email would be
    // one suspect among fifty.
    flowType: "pkce",
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
