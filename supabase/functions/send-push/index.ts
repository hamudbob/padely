/**
 * send-push — deliver a notification to one or more people's devices.
 *
 * Called by the database (webhooks / pg_net) and by scheduled jobs, never by
 * the app. See the auth check below: a function that can send a notification
 * to any user is not something an end user's token may invoke.
 *
 *   POST /functions/v1/send-push
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   {
 *     "userIds": ["uuid", ...],
 *     "title":   "Court's booked",
 *     "body":    "Tuesday 19:00 at Kemang. 4 places left.",
 *     "path":    "/e/abc123",        // where a tap goes. Optional.
 *     "collapseId": "event-abc123"   // optional; supersedes an unread one
 *   }
 *
 * ── Two APNs facts that shape everything here ────────────────────────────
 *
 * 1. SANDBOX AND PRODUCTION ARE DIFFERENT SERVERS. A token from an Xcode
 *    build works only against api.sandbox.push.apple.com; a TestFlight or
 *    App Store token only against api.push.apple.com. Send to the wrong one
 *    and APNs says BadDeviceToken — indistinguishable, from the outside,
 *    from a notification nobody sent.
 *
 *    The app records which environment it *thinks* it is, but it is guessing
 *    (the truth lives in the aps-environment entitlement, which JavaScript
 *    cannot read). So this treats the stored value as a hint: on
 *    BadDeviceToken it retries the other environment, and if that works it
 *    corrects the row. One failed send, then permanently right.
 *
 * 2. THE PROVIDER TOKEN IS RATE-LIMITED. Apple rejects a provider that mints
 *    new authentication JWTs too often — TooManyProviderTokenUpdates — and
 *    asks for one token reused for up to an hour, refreshed no more than
 *    every 20 minutes. Generating one per request would eventually trip that
 *    under any real load. It is cached in module scope below, which survives
 *    between invocations for as long as the isolate does.
 *
 * Secrets: APNS_PRIVATE_KEY (contents of AuthKey_XXXXXXXXXX.p8, including
 * the BEGIN/END lines). The identifiers below are not secret.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") ?? "2Q959XG9JZ";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") ?? "2X5GJP8K39";
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY");

const HOST = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

type Environment = keyof typeof HOST;
const other = (e: Environment): Environment => (e === "production" ? "sandbox" : "production");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/* ── The APNs provider token ─────────────────────────────────────────────── */

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return der;
}

/** Cached across invocations for as long as this isolate lives. See fact 2. */
let cachedToken: { jwt: string; madeAt: number } | null = null;
const TOKEN_MAX_AGE_MS = 40 * 60 * 1000; // Apple's ceiling is 60; 40 leaves room.

async function providerToken(): Promise<string> {
  if (!APNS_PRIVATE_KEY) throw new Error("APNS_PRIVATE_KEY is not set");
  if (cachedToken && Date.now() - cachedToken.madeAt < TOKEN_MAX_AGE_MS) return cachedToken.jwt;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(APNS_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  // Note how much smaller this is than the Sign in with Apple secret: APNs
  // wants only issuer and issued-at. No aud, no sub, and deliberately no exp —
  // Apple derives expiry from iat and rejects a token carrying its own.
  const header = b64urlText(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID }));
  const payload = b64urlText(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  const jwt = `${header}.${payload}.${b64url(signature)}`;
  cachedToken = { jwt, madeAt: Date.now() };
  return jwt;
}

/* ── One device ──────────────────────────────────────────────────────────── */

interface SendOutcome {
  ok: boolean;
  status: number;
  reason?: string;
  /** Set when the stored environment turned out to be wrong. */
  correctedTo?: Environment;
  /** APNs says this token is dead and should never be used again. */
  dead?: boolean;
}

async function pushOnce(
  env: Environment,
  token: string,
  bundleId: string,
  payload: unknown,
  collapseId?: string,
): Promise<{ status: number; reason?: string }> {
  const headers: Record<string, string> = {
    authorization: `bearer ${await providerToken()}`,
    "apns-topic": bundleId,
    // "alert" means it may wake the screen and make a sound. "background"
    // would be silent and is throttled hard by iOS — wrong for anything a
    // person is meant to read.
    "apns-push-type": "alert",
    // 10 = deliver now. 5 = power-considerate, which can mean "in a while".
    // A session starting in two hours is not a while.
    "apns-priority": "10",
    "content-type": "application/json",
  };
  // Replaces an earlier unread notification with the same id rather than
  // stacking. Three "a spot opened" alerts for one session is noise.
  if (collapseId) headers["apns-collapse-id"] = collapseId.slice(0, 64);

  const res = await fetch(`${HOST[env]}/3/device/${token}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (res.status === 200) return { status: 200 };
  // Errors come back as {"reason":"BadDeviceToken"}.
  let reason: string | undefined;
  try {
    reason = (JSON.parse(await res.text()) as { reason?: string }).reason;
  } catch {
    reason = undefined;
  }
  return { status: res.status, reason };
}

/**
 * Send to one device, with the environment fallback described at the top.
 */
async function sendToDevice(
  row: { token: string; environment: Environment; bundle_id: string },
  payload: unknown,
  collapseId?: string,
): Promise<SendOutcome> {
  let attempt = await pushOnce(row.environment, row.token, row.bundle_id, payload, collapseId);

  // 400/BadDeviceToken is the signature of "right token, wrong environment".
  // Any other 400 is a genuinely malformed request and retrying is pointless.
  if (attempt.status === 400 && attempt.reason === "BadDeviceToken") {
    const fallback = other(row.environment);
    const second = await pushOnce(fallback, row.token, row.bundle_id, payload, collapseId);
    if (second.status === 200) {
      return { ok: true, status: 200, correctedTo: fallback };
    }
    // Failed in both. Now it really is a bad token.
    return { ok: false, status: second.status, reason: second.reason, dead: true };
  }

  // 410 Gone: the app was deleted, or the token was replaced. Apple is
  // explicit that a provider must stop using it.
  if (attempt.status === 410 || attempt.reason === "Unregistered") {
    return { ok: false, status: attempt.status, reason: attempt.reason ?? "Unregistered", dead: true };
  }

  return { ok: attempt.status === 200, status: attempt.status, reason: attempt.reason };
}

/* ── The handler ─────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Who may call this ────────────────────────────────────────────────────
  //
  // This function can put arbitrary text on any user's lock screen, so it must
  // never be reachable with an ordinary signed-in token. "Padelier: confirm
  // your card details" is a very convincing phishing notification.
  //
  // It authenticates on a PURPOSE-MADE SECRET rather than on Supabase's
  // service role key. The first version compared the caller's bearer token to
  // SUPABASE_SERVICE_ROLE_KEY, which assumed the key shown in the dashboard is
  // byte-identical to the one injected here. That is not guaranteed: a project
  // can carry both legacy JWT keys and the newer sb_secret_* format, and either
  // can be rotated independently. The result was a 403 for a correct
  // service_role key, with nothing to indicate why.
  //
  // A dedicated secret has none of that coupling. It also survives Supabase
  // changing its key formats again, and a database webhook can send it as a
  // custom header just as easily as curl can.
  const expected = Deno.env.get("PUSH_SEND_SECRET");
  if (!expected) {
    // Loud, not silent. A missing secret means nothing can ever send, and
    // "Not allowed" would send you looking in entirely the wrong place.
    console.error("PUSH_SEND_SECRET is not set — refusing every request.");
    return json({ error: "Server not configured: PUSH_SEND_SECRET is missing." }, 500);
  }

  const offered = req.headers.get("x-push-secret") ?? "";
  // Length-independent comparison. The timing signal here is negligible, but
  // it costs one line not to leak one.
  const equal =
    offered.length === expected.length &&
    offered.split("").reduce((acc, ch, i) => acc | (ch.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0;
  if (!equal) return json({ error: "Not allowed." }, 403);

  let input: {
    userIds?: string[];
    title?: string;
    body?: string;
    path?: string;
    collapseId?: string;
  };
  try {
    input = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const userIds = (input.userIds ?? []).filter((id) => typeof id === "string");
  if (userIds.length === 0) return json({ error: "userIds is required." }, 400);
  if (!input.title || !input.body) return json({ error: "title and body are required." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const { data: devices, error } = await admin
    .from("device_tokens")
    .select("id, user_id, token, environment, bundle_id")
    .in("user_id", userIds)
    .is("disabled_at", null);
  if (error) return json({ error: error.message }, 500);
  if (!devices || devices.length === 0) return json({ sent: 0, devices: 0, note: "No registered devices." });

  const payload = {
    aps: {
      alert: { title: input.title, body: input.body },
      sound: "default",
      // Badge deliberately omitted. A number on the icon is a promise that
      // something in the app is unread and countable, and we have no such
      // concept — setting it to 1 forever is how apps end up with a badge
      // nobody can clear.
    },
    // Our own keys travel alongside `aps`. `path` is what the tap handler
    // routes on; see lib/push.ts, which accepts only in-app paths.
    path: input.path ?? null,
  };

  let sent = 0;
  const failures: { userId: string; reason?: string; status: number }[] = [];

  // Sequential rather than parallel. These batches are a club, not a
  // broadcast — a few dozen at most — and APNs is happier with an orderly
  // stream than with fifty simultaneous connections from one provider.
  for (const device of devices) {
    const outcome = await sendToDevice(
      { token: device.token, environment: device.environment as Environment, bundle_id: device.bundle_id },
      payload,
      input.collapseId,
    );

    if (outcome.correctedTo) {
      // The app's guess was wrong. Fix it so the next send is right first time.
      await admin.from("device_tokens").update({ environment: outcome.correctedTo }).eq("id", device.id);
      console.log(`device ${device.id}: environment corrected to ${outcome.correctedTo}`);
    }

    if (outcome.dead) {
      // Disabled, not deleted: "we stopped being able to reach this phone on
      // 3 March" answers "why didn't I get told", and a deleted row answers
      // nothing.
      await admin.from("device_tokens").update({ disabled_at: new Date().toISOString() }).eq("id", device.id);
    }

    if (outcome.ok) {
      sent++;
      await admin.from("device_tokens").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
    } else {
      failures.push({ userId: device.user_id, reason: outcome.reason, status: outcome.status });
      console.error(`push failed for ${device.user_id}: ${outcome.status} ${outcome.reason ?? ""}`);
    }
  }

  return json({ sent, devices: devices.length, failures });
});
