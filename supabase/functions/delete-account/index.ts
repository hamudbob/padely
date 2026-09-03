/**
 * delete-account — erase the caller's account, and tell Apple about it.
 *
 * WHY THIS IS A SERVER FUNCTION. Deleting used to be one RPC straight from the
 * browser, and for the database half it still is. What cannot happen in a
 * browser is the other half: App Store guideline 5.1.1(v) requires that an app
 * offering Sign in with Apple revoke the user's tokens with Apple when they
 * delete their account, and revoking is authenticated with the Apple client
 * secret — a JWT signed by the .p8 private key. That key must never reach a
 * client, so the call has to happen somewhere the client cannot read.
 *
 * ── The order of operations is the interesting design decision ────────────
 *
 *   1. read the stored refresh token   (before anything is destroyed)
 *   2. delete the account              (the user's actual request)
 *   3. revoke with Apple               (best effort)
 *   4. drop the stored token           (only once step 3 succeeded)
 *
 * Revoking BEFORE deleting looks tidier and is worse. If the revoke succeeds
 * and the delete then fails, the person is left with a live account they can
 * no longer sign into — their next Apple sign-in would be treated as a brand
 * new user and land them in an empty account, with their real one orphaned
 * and unreachable. Deleting first inverts that: if the revoke fails, the
 * account is gone as they asked and the only residue is a stale entry in
 * their Apple ID settings, which they can clear themselves and which we
 * report honestly in the response.
 *
 * A failed revoke therefore never fails the request. Deletion is a right, not
 * a favour; Apple being unreachable is not a reason to refuse it.
 *
 * ── Secrets this function needs ───────────────────────────────────────────
 *
 *   APPLE_PRIVATE_KEY   the full contents of AuthKey_XXXXXXXXXX.p8, including
 *                       the BEGIN and END lines
 *
 * The other three are identifiers, not secrets, and are baked in below with an
 * env override so a future project can change them without a code edit.
 *
 * Note the five-minute expiry on the secret we mint here. The one pasted into
 * the Supabase dashboard has to last six months because a human has to come
 * back and replace it; this one is generated per request and used immediately,
 * so it can be short-lived — and it never expires in the sense that matters,
 * because there is nothing for anyone to remember to renew.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const APPLE_TEAM_ID = Deno.env.get("APPLE_TEAM_ID") ?? "2Q959XG9JZ";
const APPLE_KEY_ID = Deno.env.get("APPLE_KEY_ID") ?? "KTF7MZ7R4S";
const APPLE_SERVICES_ID = Deno.env.get("APPLE_SERVICES_ID") ?? "id.padelier.web";
const APPLE_PRIVATE_KEY = Deno.env.get("APPLE_PRIVATE_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

/* ── Apple client secret ─────────────────────────────────────────────────── */

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

/** PEM → DER. The BEGIN/END lines and every newline come off; what is left is
 *  base64 of the PKCS#8 structure WebCrypto wants. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return der;
}

/**
 * Mint the ES256 JWT Apple accepts as a client secret.
 *
 * WebCrypto's ECDSA sign returns the raw r‖s pair, which is exactly the JWT
 * signature format. Node's crypto returns DER by default and needs
 * `dsaEncoding: "ieee-p1363"` to match — a difference worth knowing, because
 * a DER signature here is rejected by Apple as a bare `invalid_client` with
 * nothing to indicate the signature was the problem.
 */
async function appleClientSecret(): Promise<string> {
  if (!APPLE_PRIVATE_KEY) throw new Error("APPLE_PRIVATE_KEY is not set");

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(APPLE_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const iat = Math.floor(Date.now() / 1000);
  const header = b64urlText(JSON.stringify({ alg: "ES256", kid: APPLE_KEY_ID }));
  const payload = b64urlText(
    JSON.stringify({
      iss: APPLE_TEAM_ID,
      iat,
      exp: iat + 300,
      aud: "https://appleid.apple.com",
      // The Services ID, not the bundle ID — Apple treats the Services ID as
      // the OAuth client for both web and the native flow we use.
      sub: APPLE_SERVICES_ID,
    }),
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${b64url(signature)}`;
}

/** Returns null on success, or a short reason we can report and log. */
async function revokeWithApple(refreshToken: string): Promise<string | null> {
  let secret: string;
  try {
    secret = await appleClientSecret();
  } catch (e) {
    return `client secret: ${e instanceof Error ? e.message : String(e)}`;
  }

  const res = await fetch("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: APPLE_SERVICES_ID,
      client_secret: secret,
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });

  // Apple answers 200 with an empty body. Anything else carries a JSON error.
  if (res.ok) return null;
  return `apple ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

/* ── The handler ─────────────────────────────────────────────────────────── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Please sign in." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Acts as the caller. delete_my_account() reads auth.uid(), so this is what
  // makes it delete THEIR account and nobody else's — the function takes no
  // user id and there is no way to pass one.
  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return json({ error: "Please sign in." }, 401);
  const uid = userData.user.id;

  const admin = createClient(url, serviceKey);

  // 1. Read the token first — after step 2 the row may be unreachable, and we
  //    would have no way to tell Apple anything.
  const { data: tokenRow } = await admin
    .from("provider_refresh_tokens")
    .select("provider, refresh_token")
    .eq("user_id", uid)
    .maybeSingle();

  // 2. The thing they actually asked for.
  const { error: deleteError } = await asUser.rpc("delete_my_account");
  if (deleteError) {
    return json({ error: deleteError.message ?? "Could not delete the account." }, 500);
  }

  // 3. Best effort, never fatal.
  let appleRevoked = false;
  let revokeNote: string | null = null;
  if (tokenRow?.provider === "apple" && tokenRow.refresh_token) {
    revokeNote = await revokeWithApple(tokenRow.refresh_token);
    appleRevoked = revokeNote === null;
    if (revokeNote) console.error(`apple revoke failed for ${uid}: ${revokeNote}`);
  }

  // 4. Drop the token only if it did its job. Keeping it after a failure is
  //    what makes a retry possible; keeping it after success would be holding
  //    a credential for an account that no longer exists.
  if (appleRevoked) {
    await admin.from("provider_refresh_tokens").delete().eq("user_id", uid);
  }

  return json({ deleted: true, appleRevoked });
});
