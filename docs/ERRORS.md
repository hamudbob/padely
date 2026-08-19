# Error codes

Every failure the app can show carries a code. When someone quotes one, paste it into the admin
console's search box — it resolves straight to that error's group, with the stack, how many times it
has happened, and to whom.

**Curated codes** (`PLR-1001`, `PLR-2002`…) are the conditions listed below: a known meaning and a
known next step. **Automatic codes** (`PLR-U-7F3A`) cover everything not yet catalogued — derived
from the error itself, so the same failure produces the same code on every device forever. An
automatic code explains nothing on its own; it's a key, and that's enough to find the rest.

Form validation — "Enter both teams' scores" — deliberately gets no code. It isn't a failure, and a
reference number on it would be noise.

This file is generated: `npx tsx scripts/gen_errors_doc.ts > docs/ERRORS.md`. Edit the catalogue in
`src/lib/errors.ts`, not this file.

## 1xxx · Account and sign-in

### PLR-1001 — Sign-in rejected

The email and password combination was refused. Supabase returns the same answer whether the password is wrong or no such account exists — deliberately, so an attacker can't use it to discover who has an account.

**What to do:** Have them reset their password. If reset mail never arrives, check the account exists at all before assuming the password is the problem.

### PLR-1002 — Email never confirmed

The account exists but its confirmation link was never opened, so sign-in will keep failing no matter how many times it's recreated.

**What to do:** Resend the confirmation, check their spam folder, or confirm the account by hand in Supabase's Auth panel.

### PLR-1003 — Session expired or rejected

The access token was refused. Usually it simply expired; it also happens when an account was deleted or banned while its token was still cached in the browser.

**What to do:** Sign out and back in. If it recurs immediately, check the account's row in auth.users for deleted_at and banned_until.

### PLR-1004 — Account is banned or deleted

The auth row exists but is closed. delete_my_account leaves exactly this: email nulled, banned_until set to infinity, kept only so match history stays attached to something.

**What to do:** That account can't be revived by design. The email is free — they sign up again as a new account.

### PLR-1005 — Not signed in

A screen that needs an account was reached without one, usually after a token expired mid-visit.

**What to do:** Sign in again. If it happens on a screen that should be public, that route is guarded too tightly.

## 2xxx · Your own data

### PLR-2001 — Home screen couldn't load your sessions

getHostHomeSummary failed. The message names sessions, but the failure is often one query earlier — the account's team.

**What to do:** Open the account in the admin console. Check it has exactly one team row, then look at the underlying code on this same error.

### PLR-2002 — Expected one row, found several

A query that demands a single row got more than one. This is what two `teams` rows for one account did: the home screen's first query failed and everything behind it fell over, permanently, on every device.

**What to do:** Find the duplicate and remove it. 0044 dedupes teams and adds the unique index that prevents it; if this appears for another table, that table needs the same treatment.

### PLR-2003 — Your profile couldn't be read

The profiles row is missing or unreadable. A missing row usually means the sign-up trigger didn't fire.

**What to do:** Check for a profiles row with that user id. If there isn't one, create it — the account otherwise works but has no identity.

### PLR-2004 — Rating or record couldn't be read

The rating history or participation lookup failed.

**What to do:** Check the account's diagnosis block in the admin console: rating with no surviving history is a known, repairable state.

## 3xxx · A live session

### PLR-3001 — Session wouldn't start

Creating the session was refused by the database. A format the schema doesn't accept is the usual cause — a check constraint rejecting the value.

**What to do:** Read the underlying code. 23514 means a check constraint; the last time it happened a migration hadn't been applied.

### PLR-3002 — Session couldn't be loaded

The live session's snapshot failed to read. For a player rather than the host this is often permission, not absence.

**What to do:** Open the session in the admin console — it shows what the host sees and what a participant is allowed to see.

### PLR-3003 — Score wouldn't save

A score failed to reach the server. Scores queue locally and retry, so this only surfaces when the write itself was rejected rather than merely offline.

**What to do:** Check the match still exists and the session isn't already ended.

### PLR-3004 — Next round couldn't be generated

Round generation failed or was refused — most often because some scores hadn't synced yet, which the app blocks on deliberately.

**What to do:** If the message mentions waiting to sync, that's correct behaviour. Otherwise check every match in the current round is final.

### PLR-3005 — Session wouldn't end

Ending failed. The status change and the rating and league writes that follow it are separate steps, and the later ones are best-effort.

**What to do:** Check the session in the admin console: an ended session that never wrote its ratings can be finished with Re-run finalize.

### PLR-3006 — Round couldn't be redrawn

Randomize or refresh couldn't build a valid round from the current roster.

**What to do:** Usually genuine: too few active players, or a format that pins pairings. The message says which.

## 4xxx · Clubs and league

### PLR-4001 — Club couldn't be loaded

The club, its members or its stats failed to read.

**What to do:** If the reader is a member rather than the owner, suspect permissions: RLS denies by returning nothing, not by erroring.

### PLR-4002 — League table couldn't be built

One of the league's three reads failed — results, members, or which sessions count.

**What to do:** Compare what the member sees with what the host sees. A board that is full for one and empty for the other is a permissions bug.

### PLR-4003 — Club action was refused

Joining, inviting, accepting or a role change was rejected — usually because the caller isn't allowed to do it.

**What to do:** Check the caller's role. Only an owner may change roles.

## 5xxx · Joining and claiming

### PLR-5001 — Join code didn't work

No live or draft session matches that code.

**What to do:** Codes belong to one session and die with it. Confirm the code in the admin console's search box.

### PLR-5002 — Join request failed

The request to join a session couldn't be filed.

**What to do:** Check the session is still accepting players and isn't already ended.

### PLR-5003 — Claiming a spot failed

Attaching an account to a player already on the roster was refused.

**What to do:** One account can hold one seat per session. The admin session page shows who is linked to what, and can re-link.

## 6xxx · This device

### PLR-6001 — Image couldn't be processed

The browser refused to decode or resize the picture — an unusual format, or a photo too large for the device's memory.

**What to do:** Ask for a normal JPEG or PNG. Nothing server-side is involved.

### PLR-6002 — Recap card couldn't be drawn

Canvas isn't available or the drawing failed. Some privacy modes disable canvas entirely.

**What to do:** Nothing to fix server-side. Standings and the podium are unaffected.

### PLR-6003 — Upload failed

The avatar or club logo didn't reach storage.

**What to do:** Check the storage bucket's policies and the file's size.

## 9xxx · The plumbing

### PLR-9001 — The server had a problem

A 5xx. Nothing the person did — the database or the API was unwell for that moment.

**What to do:** Check Supabase's status and logs around the timestamp on the error.

### PLR-9002 — Too many requests

Rate limited. Repeated sign-in or sign-up attempts from one address hit this first.

**What to do:** Wait it out. If it's an ordinary user hitting it, the limit is too tight for real use.

### PLR-9003 — Permission denied

The database refused the operation outright. Notable because this app's usual failure is the opposite — RLS returning an empty result and no error at all.

**What to do:** An explicit refusal points at a GRANT or a policy on a table the caller shouldn't be touching directly.

### PLR-9004 — That already exists

A unique constraint rejected a duplicate. Often correct behaviour: it's what stops a second team, a second claim, a second membership.

**What to do:** If a user sees this, some code is treating a rejected duplicate as a failure when it should treat it as 'someone else got there first'.

### PLR-9005 — No connection

The request never left the device.

**What to do:** Nothing to fix. Scores queue locally and sync on their own; other screens need signal.

---

_29 curated codes._

