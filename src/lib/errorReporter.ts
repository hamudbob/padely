import { codeFor } from "./errors";

/**
 * Client-side error capture.
 *
 * Until this existed, an exception in the app went to a console nobody was
 * reading. Every bug this month was found by a person noticing a blank screen
 * and mentioning it days later — which only works while the only users are
 * the developer and his club.
 *
 * THREE KINDS OF FAILURE, and the first version only caught one of them:
 *
 *   1. a thrown exception during render        → ErrorBoundary        ✓
 *   2. an unhandled promise rejection          → window listeners      ✓
 *   3. a request that came back 4xx/5xx and was CAUGHT by the screen,
 *      which then rendered "Could not load your sessions."            ✗
 *
 * The third is the one users actually report, and it was invisible: a caught
 * error never reaches a boundary or window.onerror. So the Supabase client is
 * now built on a fetch that reports every failing response, and screens can
 * report what they caught. That covers auth failures too — a 400 from the
 * token endpoint is a returned error object, not an exception, and would
 * otherwise never have been recorded anywhere.
 *
 * Deliberately NOT sent: request bodies (they hold passwords), form values,
 * message contents. Method, path, status, and a short slice of the response —
 * enough to find it, not a second copy of the database.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? import.meta.env.MODE;

/** The pristine fetch, captured before anything wraps it, so reporting can
 *  never recurse through the reporting wrapper. */
const rawFetch: typeof fetch | null = typeof window !== "undefined" ? window.fetch.bind(window) : null;

/** Per page-load ceiling. A render loop can throw thousands of times a second. */
const MAX_PER_PAGELOAD = 25;
/** The same error twice inside this window is one error. */
const DEDUPE_MS = 60_000;

const IGNORED = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /AbortError/i,
  /The operation was aborted/i,
  /Failed to fetch|NetworkError|Load failed/i,
];

let installed = false;
let sent = 0;
const lastSeen = new Map<string, number>();

function shouldSend(message: string): boolean {
  if (sent >= MAX_PER_PAGELOAD) return false;
  if (IGNORED.some((re) => re.test(message))) return false;
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return false;

  const key = message.slice(0, 160);
  const now = Date.now();
  const previous = lastSeen.get(key);
  if (previous !== undefined && now - previous < DEDUPE_MS) return false;
  lastSeen.set(key, now);
  return true;
}

/**
 * The signed-in user's access token, read straight out of the storage the
 * Supabase client keeps it in. Used so a report is attributed to the person it
 * happened to. Absent (signed out, or unreadable) simply means the row lands
 * with a null user_id — which is exactly right for a failure that happened on
 * a public page or at the sign-in screen.
 */
function accessToken(): string | null {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { access_token?: string };
      if (parsed?.access_token) return parsed.access_token;
    }
  } catch {
    /* private mode, or a shape we don't recognise — not worth a second thought */
  }
  return null;
}

export type ErrorKind = "error" | "rejection" | "boundary" | "query";

function post(payload: Record<string, unknown>): void {
  if (!rawFetch || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  const token = accessToken();
  void rawFetch(`${SUPABASE_URL}/rest/v1/rpc/report_client_error`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
    keepalive: true, // survives the page being closed straight after a crash
  }).catch(() => {
    /* reporting failed — there is nowhere left to report that to */
  });
}

/**
 * Report one error. Safe to call from anywhere, including a catch block in a
 * hot path — it returns immediately and never rejects.
 */
export function reportError(
  error: unknown,
  kind: ErrorKind = "error",
  context?: Record<string, unknown>,
): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message || String(error);
    if (!shouldSend(message)) return;
    sent += 1;
    // Derived, not assigned: the same failure produces the same code on every
    // device, so a user quoting one lands you on this exact group.
    const code = codeFor(error, typeof context?.where === "string" ? context.where : "");
    post({
      p_kind: kind,
      p_code: code,
      p_message: message,
      p_stack: err.stack ?? null,
      p_route: typeof location !== "undefined" ? location.pathname + location.search : null,
      p_app_version: APP_VERSION,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      p_context: context ?? null,
    });
  } catch {
    /* never let the reporter be the thing that breaks the page */
  }
}

/**
 * For a `.catch()` that shows the user a message instead of crashing — the
 * "Could not load your sessions." path. `where` names the screen so the log
 * says which one, since the stack of a caught async error rarely does.
 */
export function reportHandledError(error: unknown, where: string, context?: Record<string, unknown>): void {
  reportError(error, "query", { ...(context ?? {}), where });
}

/**
 * A fetch that records every failing response before handing it back
 * unchanged. Given to the Supabase client, so every PostgREST and GoTrue call
 * the app makes is covered — including the ones the app catches and turns into
 * a polite message.
 */
export function reportingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const doFetch = rawFetch ?? fetch;
  return doFetch(input, init).then((response) => {
    try {
      if (response.status < 400) return response;

      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      // Never report the reporter — that is how a logging loop starts.
      if (url.includes("report_client_error")) return response;

      // Path only. A query string can carry an email or a token, and neither
      // belongs in a log this app's operator reads over someone's shoulder.
      let path = url;
      try {
        path = new URL(url, location.origin).pathname;
      } catch {
        /* keep the raw string */
      }

      // The RESPONSE body is safe and is usually the whole answer ("Invalid
      // login credentials", "Email not confirmed", a PostgREST error code).
      // The REQUEST body is never touched: it holds passwords.
      response
        .clone()
        .text()
        .then((body) => {
          reportError(new Error(`${response.status} on ${path}`), "query", {
            status: response.status,
            path,
            method: (init?.method ?? "GET").toUpperCase(),
            response: body.slice(0, 300),
          });
        })
        .catch(() => undefined);
    } catch {
      /* a failure inside failure-reporting is not worth propagating */
    }
    return response;
  });
}

/** Call once, at startup. Idempotent. */
export function installErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    reportError(event.error ?? event.message, "error", {
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    reportError(event.reason, "rejection");
  });
}
