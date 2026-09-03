#!/usr/bin/env node
/**
 * Generate the Apple "client secret" that Supabase's Sign in with Apple panel
 * wants in its Secret Key (for OAuth) field.
 *
 * WHY A SCRIPT AND NOT A PASTE. That field does not take the .p8 file and it
 * does not take the Key ID. Apple's OAuth client secret is a JWT signed with
 * the .p8 private key — which is why Supabase warns that it expires every six
 * months. A private key has no expiry; a token does.
 *
 * The key never leaves this machine. Run it in your own Terminal, copy the one
 * line it prints, paste that into Supabase.
 *
 *   node scripts/apple-client-secret.mjs ~/Downloads/AuthKey_XXXXXXXXXX.p8
 *
 * The Key ID is read from the filename. If you renamed the file, pass it:
 *
 *   node scripts/apple-client-secret.mjs ./key.p8 ABC123XYZ9
 *
 * WHEN IT EXPIRES. Apple caps these at six months. Put the printed date in a
 * calendar — when it lapses, Sign in with Apple stops working for everyone at
 * once, with an error that says nothing useful. Re-run this script and paste
 * the new token; nothing else changes, and no user has to sign in again.
 */

import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

// Padelier's own identifiers. `sub` is the Services ID, not the bundle ID —
// even for the native app. Apple treats the Services ID as the OAuth client;
// the bundle ID is listed separately in Supabase's Client IDs field.
const TEAM_ID = "2Q959XG9JZ";
const SERVICES_ID = "id.padelier.web";

const p8Path = process.argv[2];
if (!p8Path) {
  console.error("Usage: node scripts/apple-client-secret.mjs <path-to.p8> [keyId]");
  process.exit(1);
}

const keyId = process.argv[3] ?? p8Path.match(/AuthKey_([A-Z0-9]+)\.p8$/i)?.[1];
if (!keyId) {
  console.error(
    "Couldn't read the Key ID from the filename. Pass it as a second argument:\n" +
      "  node scripts/apple-client-secret.mjs ./key.p8 ABC123XYZ9",
  );
  process.exit(1);
}

let pem;
try {
  pem = readFileSync(p8Path, "utf8");
} catch (e) {
  console.error(`Can't read ${p8Path}\n${e.message}`);
  process.exit(1);
}
if (!pem.includes("BEGIN PRIVATE KEY")) {
  console.error(`${p8Path} doesn't look like a .p8 key — it should start with -----BEGIN PRIVATE KEY-----`);
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const iat = Math.floor(Date.now() / 1000);
const exp = iat + 86400 * 180; // Apple's ceiling is six months.

const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
const payload = b64url(
  JSON.stringify({
    iss: TEAM_ID,
    iat,
    exp,
    aud: "https://appleid.apple.com",
    sub: SERVICES_ID,
  }),
);

// ieee-p1363, not the DER default. JWT wants the raw r||s pair; Node signs in
// DER unless told otherwise, and Apple rejects that with a generic
// invalid_client — a full afternoon of looking in the wrong place.
const signer = createSign("SHA256");
signer.update(`${header}.${payload}`);
const signature = b64url(
  signer.sign({ key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" }),
);

console.log(`\nTeam ID:     ${TEAM_ID}`);
console.log(`Key ID:      ${keyId}`);
console.log(`Services ID: ${SERVICES_ID}`);
console.log(`Expires:     ${new Date(exp * 1000).toDateString()}  <- put this in your calendar\n`);
console.log("Paste this into Supabase's Secret Key (for OAuth) field:\n");
console.log(`${header}.${payload}.${signature}\n`);
