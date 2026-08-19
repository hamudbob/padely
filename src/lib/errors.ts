/**
 * Error codes.
 *
 * "Could not load your sessions." cost two hours and a database audit. A user
 * quoting PDL-2002 would have cost one message. So every failure the app can
 * show gets a code, and the code is the thing you look up.
 *
 * TWO KINDS, because you cannot hand-write a code for a failure you haven't
 * thought of yet:
 *
 *   CURATED  — PDL-1001, PDL-2002 … a known condition with a documented
 *              meaning, likely cause and fix. Listed in CATALOGUE below and
 *              in docs/ERRORS.md.
 *   AUTOMATIC — PDL-U-7F3A … anything unclassified. Derived from the error
 *              itself, so the SAME failure always produces the SAME code on
 *              every device. It explains nothing on its own, and that's fine:
 *              it's a key. Paste it into the admin console's search box and
 *              you land on that exact error group, its stack, its count and
 *              everyone it has happened to.
 *
 * WHAT DOESN'T GET A CODE: form validation. "Enter both teams' scores" is
 * guidance, not a failure — nobody needs a reference number for typing
 * nothing into a box. Codes are for things that went wrong, not for things
 * the person hasn't done yet.
 */

export interface CatalogueEntry {
  /** One line, shown in the admin console next to the code. */
  title: string;
  /** What it actually means, in the app's own terms. */
  meaning: string;
  /** What to do about it — the thing worth writing down while it's fresh. */
  action: string;
}

export const CATALOGUE: Record<string, CatalogueEntry> = {
  // ── 1xxx · account and sign-in ──────────────────────────────────────
  "PDL-1001": {
    title: "Sign-in rejected",
    meaning: "The email and password combination was refused. Supabase returns the same answer whether the password is wrong or no such account exists — deliberately, so an attacker can't use it to discover who has an account.",
    action: "Have them reset their password. If reset mail never arrives, check the account exists at all before assuming the password is the problem.",
  },
  "PDL-1002": {
    title: "Email never confirmed",
    meaning: "The account exists but its confirmation link was never opened, so sign-in will keep failing no matter how many times it's recreated.",
    action: "Resend the confirmation, check their spam folder, or confirm the account by hand in Supabase's Auth panel.",
  },
  "PDL-1003": {
    title: "Session expired or rejected",
    meaning: "The access token was refused. Usually it simply expired; it also happens when an account was deleted or banned while its token was still cached in the browser.",
    action: "Sign out and back in. If it recurs immediately, check the account's row in auth.users for deleted_at and banned_until.",
  },
  "PDL-1004": {
    title: "Account is banned or deleted",
    meaning: "The auth row exists but is closed. delete_my_account leaves exactly this: email nulled, banned_until set to infinity, kept only so match history stays attached to something.",
    action: "That account can't be revived by design. The email is free — they sign up again as a new account.",
  },
  "PDL-1005": {
    title: "Not signed in",
    meaning: "A screen that needs an account was reached without one, usually after a token expired mid-visit.",
    action: "Sign in again. If it happens on a screen that should be public, that route is guarded too tightly.",
  },

  // ── 2xxx · your own data ────────────────────────────────────────────
  "PDL-2001": {
    title: "Home screen couldn't load your sessions",
    meaning: "getHostHomeSummary failed. The message names sessions, but the failure is often one query earlier — the account's team.",
    action: "Open the account in the admin console. Check it has exactly one team row, then look at the underlying code on this same error.",
  },
  "PDL-2002": {
    title: "Expected one row, found several",
    meaning: "A query that demands a single row got more than one. This is what two `teams` rows for one account did: the home screen's first query failed and everything behind it fell over, permanently, on every device.",
    action: "Find the duplicate and remove it. 0044 dedupes teams and adds the unique index that prevents it; if this appears for another table, that table needs the same treatment.",
  },
  "PDL-2003": {
    title: "Your profile couldn't be read",
    meaning: "The profiles row is missing or unreadable. A missing row usually means the sign-up trigger didn't fire.",
    action: "Check for a profiles row with that user id. If there isn't one, create it — the account otherwise works but has no identity.",
  },
  "PDL-2004": {
    title: "Rating or record couldn't be read",
    meaning: "The rating history or participation lookup failed.",
    action: "Check the account's diagnosis block in the admin console: rating with no surviving history is a known, repairable state.",
  },

  // ── 3xxx · a live session ───────────────────────────────────────────
  "PDL-3001": {
    title: "Session wouldn't start",
    meaning: "Creating the session was refused by the database. A format the schema doesn't accept is the usual cause — a check constraint rejecting the value.",
    action: "Read the underlying code. 23514 means a check constraint; the last time it happened a migration hadn't been applied.",
  },
  "PDL-3002": {
    title: "Session couldn't be loaded",
    meaning: "The live session's snapshot failed to read. For a player rather than the host this is often permission, not absence.",
    action: "Open the session in the admin console — it shows what the host sees and what a participant is allowed to see.",
  },
  "PDL-3003": {
    title: "Score wouldn't save",
    meaning: "A score failed to reach the server. Scores queue locally and retry, so this only surfaces when the write itself was rejected rather than merely offline.",
    action: "Check the match still exists and the session isn't already ended.",
  },
  "PDL-3004": {
    title: "Next round couldn't be generated",
    meaning: "Round generation failed or was refused — most often because some scores hadn't synced yet, which the app blocks on deliberately.",
    action: "If the message mentions waiting to sync, that's correct behaviour. Otherwise check every match in the current round is final.",
  },
  "PDL-3005": {
    title: "Session wouldn't end",
    meaning: "Ending failed. The status change and the rating and league writes that follow it are separate steps, and the later ones are best-effort.",
    action: "Check the session in the admin console: an ended session that never wrote its ratings can be finished with Re-run finalize.",
  },
  "PDL-3006": {
    title: "Round couldn't be redrawn",
    meaning: "Randomize or refresh couldn't build a valid round from the current roster.",
    action: "Usually genuine: too few active players, or a format that pins pairings. The message says which.",
  },

  // ── 4xxx · clubs and league ─────────────────────────────────────────
  "PDL-4001": {
    title: "Club couldn't be loaded",
    meaning: "The club, its members or its stats failed to read.",
    action: "If the reader is a member rather than the owner, suspect permissions: RLS denies by returning nothing, not by erroring.",
  },
  "PDL-4002": {
    title: "League table couldn't be built",
    meaning: "One of the league's three reads failed — results, members, or which sessions count.",
    action: "Compare what the member sees with what the host sees. A board that is full for one and empty for the other is a permissions bug.",
  },
  "PDL-4003": {
    title: "Club action was refused",
    meaning: "Joining, inviting, accepting or a role change was rejected — usually because the caller isn't allowed to do it.",
    action: "Check the caller's role. Only an owner may change roles.",
  },

  // ── 5xxx · joining and claiming ─────────────────────────────────────
  "PDL-5001": {
    title: "Join code didn't work",
    meaning: "No live or draft session matches that code.",
    action: "Codes belong to one session and die with it. Confirm the code in the admin console's search box.",
  },
  "PDL-5002": {
    title: "Join request failed",
    meaning: "The request to join a session couldn't be filed.",
    action: "Check the session is still accepting players and isn't already ended.",
  },
  "PDL-5003": {
    title: "Claiming a spot failed",
    meaning: "Attaching an account to a player already on the roster was refused.",
    action: "One account can hold one seat per session. The admin session page shows who is linked to what, and can re-link.",
  },

  // ── 6xxx · this device ──────────────────────────────────────────────
  "PDL-6001": {
    title: "Image couldn't be processed",
    meaning: "The browser refused to decode or resize the picture — an unusual format, or a photo too large for the device's memory.",
    action: "Ask for a normal JPEG or PNG. Nothing server-side is involved.",
  },
  "PDL-6002": {
    title: "Recap card couldn't be drawn",
    meaning: "Canvas isn't available or the drawing failed. Some privacy modes disable canvas entirely.",
    action: "Nothing to fix server-side. Standings and the podium are unaffected.",
  },
  "PDL-6003": {
    title: "Upload failed",
    meaning: "The avatar or club logo didn't reach storage.",
    action: "Check the storage bucket's policies and the file's size.",
  },

  // ── 9xxx · the plumbing ─────────────────────────────────────────────
  "PDL-9001": {
    title: "The server had a problem",
    meaning: "A 5xx. Nothing the person did — the database or the API was unwell for that moment.",
    action: "Check Supabase's status and logs around the timestamp on the error.",
  },
  "PDL-9002": {
    title: "Too many requests",
    meaning: "Rate limited. Repeated sign-in or sign-up attempts from one address hit this first.",
    action: "Wait it out. If it's an ordinary user hitting it, the limit is too tight for real use.",
  },
  "PDL-9003": {
    title: "Permission denied",
    meaning: "The database refused the operation outright. Notable because this app's usual failure is the opposite — RLS returning an empty result and no error at all.",
    action: "An explicit refusal points at a GRANT or a policy on a table the caller shouldn't be touching directly.",
  },
  "PDL-9004": {
    title: "That already exists",
    meaning: "A unique constraint rejected a duplicate. Often correct behaviour: it's what stops a second team, a second claim, a second membership.",
    action: "If a user sees this, some code is treating a rejected duplicate as a failure when it should treat it as 'someone else got there first'.",
  },
  "PDL-9005": {
    title: "No connection",
    meaning: "The request never left the device.",
    action: "Nothing to fix. Scores queue locally and sync on their own; other screens need signal.",
  },
};

/** Stable 4-hex-digit hash — same error, same code, forever, on any device. */
function hash4(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/** Strip the parts of a message that differ run to run, so the same failure
 *  hashes to the same code: ids, numbers, quoted values, timestamps. */
function normalise(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, "<time>")
    .replace(/["'`][^"'`]*["'`]/g, "<value>")
    .replace(/\b\d+\b/g, "<n>")
    .trim()
    .slice(0, 120);
}

/** Anything the app might be handed in a catch: an Error, a PostgREST error
 *  object, a GoTrue error, a string. */
interface LooseError {
  message?: string;
  code?: string;
  status?: number;
  details?: string;
  hint?: string;
  error_description?: string;
}

function looseOf(error: unknown): LooseError {
  if (error instanceof Error) return { message: error.message, ...(error as unknown as LooseError) };
  if (error && typeof error === "object") return error as LooseError;
  return { message: String(error) };
}

/** The message a human should read, dug out of whatever shape arrived.
 *  PostgREST errors are plain objects, NOT Error instances — which is why
 *  `e instanceof Error ? e.message : "…"` silently swallowed the real reason
 *  on the home screen for a day. */
export function messageOf(error: unknown, fallback = "Something went wrong."): string {
  const e = looseOf(error);
  const message = e.message ?? e.error_description;
  return message && message.trim() ? message : fallback;
}

/**
 * The code for this failure. `where` is the screen or action, used only when
 * nothing else identifies the error — so two unrelated unknown failures don't
 * collide on one code.
 */
export function codeFor(error: unknown, where = ""): string {
  const e = looseOf(error);
  const message = (e.message ?? e.error_description ?? "").toLowerCase();
  const pg = (e.code ?? "").toUpperCase();
  const status = e.status ?? 0;

  // 1. Database and API codes — the most reliable identity there is.
  if (pg === "PGRST116") return "PDL-2002"; // single-object request, wrong row count
  if (pg === "23505") return "PDL-9004";
  if (pg === "42501") return "PDL-9003";
  if (pg === "23514") return "PDL-3001"; // check constraint — a rejected format
  if (pg === "P0002") return "PDL-3002"; // our own "not found" convention

  // 2. HTTP status, when the reporting fetch passed one through.
  if (status === 401 || status === 403) return "PDL-1003";
  if (status === 429) return "PDL-9002";
  if (status >= 500) return "PDL-9001";

  // 3. Messages we recognise — ours and GoTrue's.
  if (/email not confirmed/.test(message)) return "PDL-1002";
  if (/invalid login credentials|invalid_grant/.test(message)) return "PDL-1001";
  if (/banned|user is banned/.test(message)) return "PDL-1004";
  if (/not signed in|please (log|sign) in|session expired/.test(message)) return "PDL-1005";
  if (/multiple \(or no\) rows|more than one row/.test(message)) return "PDL-2002";
  if (/could not find your team/.test(message)) return "PDL-2001";
  if (/canvas is unavailable/.test(message)) return "PDL-6002";
  if (/browser can't process images|image/.test(message) && /process|decode|resize/.test(message)) return "PDL-6001";
  if (/failed to fetch|networkerror|load failed|offline/.test(message)) return "PDL-9005";
  if (/session not found/.test(message)) return "PDL-3002";
  if (/match not found/.test(message)) return "PDL-3003";
  if (/finish scoring every match|next round generation/.test(message)) return "PDL-3004";
  if (/round needs at least|no courts are available|nothing before it/.test(message)) return "PDL-3006";

  // 4. Where it happened, when the error itself says nothing useful. These
  //    keep an unknown failure attached to the screen it broke.
  const byPlace: Record<string, string> = {
    "PlayPage.getHostHomeSummary": "PDL-2001",
    "ProfilePage": "PDL-2004",
    "LeaguePage": "PDL-4002",
    "TeamDetailPage": "PDL-4001",
    "TeamsPage": "PDL-4001",
    "JoinPage": "PDL-5002",
    "WatchPage": "PDL-5001",
    "HostLivePage.end": "PDL-3005",
    "HostLivePage.nextRound": "PDL-3004",
    "HostLivePage.score": "PDL-3003",
    "HostLivePage.load": "PDL-3002",
    "CreateSessionPage": "PDL-3001",
    "LoginPage": "PDL-1001",
  };
  if (where && byPlace[where]) return byPlace[where];

  // 5. Everything else: a stable key derived from the failure itself.
  return `PDL-U-${hash4(`${where}|${normalise(message)}`)}`;
}

export function describe(code: string): CatalogueEntry | null {
  return CATALOGUE[code] ?? null;
}

export function isAutomatic(code: string): boolean {
  return code.startsWith("PDL-U-");
}

/**
 * Keep the error, keep the copy.
 *
 * Screens used to write `e instanceof Error ? e.message : "Couldn't rename
 * court."`, which threw the error away and kept only a sentence — and since
 * PostgREST errors are plain objects rather than Error instances, that branch
 * fired constantly and hid every real message behind a generic one. Now the
 * error itself is kept (so it can be coded and reported) and the sentence is
 * only used when the error genuinely has nothing to say.
 */
export function withFallback(error: unknown, fallback: string): unknown {
  const message = messageOf(error, "");
  if (message) return error;
  const wrapped = new Error(fallback);
  (wrapped as Error & { cause?: unknown }).cause = error;
  return wrapped;
}
