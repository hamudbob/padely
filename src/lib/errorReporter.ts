import { supabase } from "./supabase/client";

/**
 * Client-side error capture.
 *
 * Until this existed, an exception in the app went to a console nobody was
 * reading. Every bug this month was found by a person noticing a blank screen
 * and mentioning it days later — which only works while the only users are
 * the developer and his club.
 *
 * Everything here is written to be un-noticeable when it goes wrong: a
 * reporter that throws would be throwing inside the app's own error handler,
 * and an error handler that errors takes the page down with it. So every path
 * is wrapped, every failure is swallowed, and nothing is awaited by the UI.
 *
 * What is deliberately NOT sent: no message bodies, no email addresses, no
 * form values. Route, message, stack and a user id — enough to find it in the
 * code, not enough to be a second copy of the database.
 */

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? import.meta.env.MODE;

/** Per page-load ceiling. A render loop can throw thousands of times a second;
 *  after this many we stop reporting and let the server-side flood guard rest. */
const MAX_PER_PAGELOAD = 20;
/** The same error twice inside this window is one error. */
const DEDUPE_MS = 60_000;

/**
 * Noise that is not a bug in this app:
 *  - ResizeObserver's benign loop warning, which Chrome reports as an error
 *  - a fetch cancelled because the user navigated away
 *  - "Script error." — a cross-origin script (an extension), with no detail
 *  - network failures while offline, which the sync queue already handles
 */
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
  // Offline: the message would never arrive anyway, and the failure to send
  // would itself be an error. The queue is the offline story, not this.
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return false;

  const key = message.slice(0, 160);
  const now = Date.now();
  const previous = lastSeen.get(key);
  if (previous !== undefined && now - previous < DEDUPE_MS) return false;
  lastSeen.set(key, now);
  return true;
}

export type ErrorKind = "error" | "rejection" | "boundary" | "query";

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

    // Fire and forget. `void` rather than await: a slow report must never
    // delay a render, and a failed report must never surface to the user.
    void supabase
      .rpc("report_client_error" as never, {
        p_kind: kind,
        p_message: message,
        p_stack: err.stack ?? null,
        p_route: typeof location !== "undefined" ? location.pathname + location.search : null,
        p_app_version: APP_VERSION,
        p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        p_context: (context ?? null) as never,
      } as never)
      .then(undefined, () => {
        /* reporting failed — there is nowhere left to report that to */
      });
  } catch {
    /* never let the reporter be the thing that breaks the page */
  }
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
