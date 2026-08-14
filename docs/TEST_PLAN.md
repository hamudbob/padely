# Padelier — release test plan

Everything fixed between `6fa0952` and `5de3c06`, in the order that finds problems fastest.
Work top to bottom: the setup block gates everything, and each later block assumes the earlier
ones passed. Write the actual result next to each ✅ — a plan you didn't record is a plan you
didn't run.

Most of these bugs were invisible from the host's own account. **That is the single most
important thing about this plan: you cannot test this app from one account.** Nearly every
defect found in the audit was a non-host seeing an empty screen where you saw data.

---

## 0 · Setup (15 minutes, do it once)

You need two accounts and a way to be a stranger.

| What | How |
|---|---|
| **Account H** — the host | your normal account |
| **Account P** — a player | a second real email. Not an alias of H's: several bugs hinge on `players.email` matching, and an alias can mask them |
| **A stranger** | a private/incognito window, signed into nothing |
| Two browsers at once | Chrome for H, a private window (or Safari) for P. Two phones is nicer but not required |
| One phone | needed only for block 8. iPhone if you have one |

Then:

1. **Migrations.** 0037, 0038, 0039, 0040 all applied. Verify rather than remember:

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'delete_my_account','get_club_sessions','club_set_member_role',
  'get_public_session_by_id','get_my_participation','delete_session_and_unrate')
order by 1;
```
   ✅ six rows. Fewer means a migration didn't run — stop here, nothing below will behave.

```sql
select column_name from information_schema.columns
where table_name = 'rating_history' and column_name like '%_before' or column_name = 'games_after';
```
   ✅ five rows (`rating_before`, `rd_before`, `vol_before`, `games_before`, `games_after`).

2. **`npm run build`** ✅ completes with no errors. `npx tsc --noEmit` ✅ exits 0.

3. **A club** owned by H, with P as a member. Create it as H, invite or code-join as P, accept.

4. **Write down P's starting rating** from P's You tab: `______` rating, `______` games. You'll
   need this number in blocks 2 and 9.

---

## 1 · Fixed Position is playable (was: unplayable)

The bug: `side_americano` was missing from both pre-generated-format lists, so only the last
round of a fully-generated schedule would open the score picker.

As **H**:

1. Create a session, format **Fixed Position**, 8 players (type names, no accounts needed),
   2 courts. Note the round count it recommends. ✅ 7 rounds generated at start.
2. Tap into **round 1** — not the newest, the first. ✅ the score picker opens.
3. Score round 1 fully. ✅ saves, no error.
4. Jump to round 4, score it. ✅ opens and saves out of order.
5. Open the ⋯ menu. ✅ **no Refresh / Randomize** offered (this format has a fixed schedule).
6. Repeat 1–2 with **Mix Americano** and **Americano** ✅ still work as before.
7. With **Mexicano** ✅ ⋯ *does* offer Refresh/Randomize, and only the current round is scorable.

**Fails if:** tapping round 1 does nothing. That's the original bug — the format string is missing
from `isFullyPreGeneratedFormat`.

---

## 2 · Randomize can't destroy a round (was: ate one round per tap)

As **H**, on a **Mexicano** session (that's where the menu lives):

1. Score round 1, generate round 2, score it, generate round 3. Leave round 3 unscored.
2. ⋯ → **Randomize**. ✅ round 3 is redrawn, still round 3, nothing lost.
3. Now break it on purpose: Manage → mark players "left" until fewer than 4 remain.
4. ⋯ → **Randomize**. ✅ a clear message ("A round needs at least 4 active players…") and
   **round 3 still exists**. Check the round pager.
5. Restore the players, Randomize again ✅ works.
6. Turn every court off (Manage → court availability), Randomize ✅ refuses, round intact.

**Fails if:** the round disappears and an error appears. That's the old delete-then-regenerate.

---

## 3 · The club league board, from a member's account (was: empty forever)

1. As **H**, run and **end** two club sessions with "count for league" on, both including P.
2. As **P**, open the club → **League**. ✅ a populated table with P in it.
3. ✅ the header does **not** say "0 of 2 sessions qualified".
4. As **H**, same screen ✅ identical numbers.
5. As **H**, create a third session with "count for league" **off**, end it. As **P**, League
   ✅ still 2 qualifying sessions, not 3.

**Fails if:** P sees zeros while H sees a board. That's `leagueQueries` reading `sessions`
directly again — it must go through `get_club_sessions`.

---

## 4 · A player's record and counters (was: 0 with a session sitting right there)

As **P**, on the You tab, after the two sessions from block 3:

1. ✅ **Record** shows real W·L·D and form pills — not "play a session and your record shows up here".
2. ✅ **Played** ≥ 2, **Games** > 0 — not 0.
3. ✅ Rating strip and record agree: if Games says 9, the record's W+L+D should be 9.
4. ✅ **Partners & rivals** names someone real.
5. ✅ the rating trend sparkline has as many points as sessions played.

**Fails if:** the record is empty but the rating is not. That's the RLS split — the rating comes
from `profiles` (readable) and the record from `get_my_participation` (0039).

**Important:** this only counts sessions where P's player row was **linked** to their account —
today that means P used **"Claim your spot"**. If P joined by code and H confirmed them, P is
still unlinked and this block will legitimately show less. That's the next fix on the list, not a
regression.

---

## 5 · One podium for an ended session (was: a different render per entry point)

Use the **Fixed Partner** format for this block — it's where the old code showed one name instead
of a pair.

1. As **H**: create a Fixed Partner session with 6 players (3 pairs), play at least 2 rounds,
   **end** it.
2. As **H**, from Play → Recent, open it. ✅ the podium page.
3. ✅ podium names are **pairs** ("Ana & Budi"), not single players.
4. ✅ under the podium, a table listing **every** subject including rank 1 — not an empty box,
   not "Top three are on the podium above".
5. Note the exact rank order and points: `___________________`
6. As **P** (who played in it), You tab → Player tab → open the same session.
   ✅ the same podium page, ✅ the same names, ✅ the same order and points as step 5.
7. ✅ tap **Standings & rounds** → the read-only view opens, with every round and the full board.
   ✅ it does **not** ask you to log in.
8. As **H**, paste the host URL directly: `/session/<id>/host`. ✅ redirected to the podium.
   ✅ pressing Back does not bounce you forward again.
9. As a **stranger** (incognito), open the podium URL. ✅ renders fully — that's the share link.
10. As **H**, **Share recap** → the image builds. ✅ the card shows the club name, the date, and
    the podium. ✅ the QR opens the read-only view.
11. As **P**, **Share recap** ✅ the card builds for them too, with club and date present.

**Fails if:** P sees fewer names than H, or an empty standings table. Step 6 differing from step 5
in any way is the bug this block exists for.

---

## 6 · Standings show everyone (was: the board minus the podium)

1. Open the `/live/<token>` link of an **ended** session with only **4 players** (2 pairs in
   Fixed Partner, or a 4-player Americano).
2. ✅ under "Full standings", all 4 (or both pairs) are listed.
3. ✅ rank 1 appears in the table as well as on the podium, highlighted.
4. Repeat with a live session ✅ leaderboard shows everyone, unchanged.

**Fails if:** the table is empty or missing the top 3 on a small session.

---

## 7 · Club roles can't be changed by outsiders (security)

1. As **P**, note a club id you are **not** a member of (make a second club as H, don't add P).
2. As **P**, in the browser console on the app:

```js
const { data, error } = await window.supabase?.rpc?.('club_set_member_role',
  { p_club_id: '<other club id>', p_user_id: '<an admin id>', p_role: 'member' })
console.log(data, error)
```
   ✅ an error: "Only the owner can change an admin." Not `null` with no error.

   (If `window.supabase` isn't exposed, skip — block 0's migration check already proves 0038 ran,
   and I verified the behaviour against a scratch Postgres.)
3. As the club **owner**, demote a real admin through the UI ✅ still works.

---

## 8 · Accessibility and mobile (phone required)

On a **phone**, in Safari or Chrome:

1. **Pinch to zoom** anywhere in the app. ✅ the page zooms. (It used to be blocked outright.)
2. Tap into any text field — the club search, the invite email, a session name.
   ✅ the page does **not** jump/zoom on focus. All inputs are 16px now.
3. Add the app to your home screen, open it, pinch again ✅ still zooms.
4. On **desktop**, press **Tab** through the login form. ✅ a clearly visible dark ring on each
   field — not a barely-there grey halo.
5. ✅ Error messages (submit an empty form, or a wrong current password in Settings) are
   comfortably readable, not washed-out orange.
6. ✅ On the first-run "How it works" list, the 01 / 02 / 03 numerals are readable, not pale gold.
7. On the `/watch` code screen ✅ the `000000` placeholder is visible.
8. On a notched phone ✅ the back button on `/watch`, the create wizard and onboarding is not
   under the Dynamic Island.

---

## 9 · Deleting a session takes its rating with it (the new one)

This is the block to run slowly and write numbers down.

**9a — delete the most recent session (exact undo)**

1. As **P**, record the You tab numbers now: rating `______`, games `______`. Call this **BEFORE**.
2. As **H**, run a short session including P (claim-your-spot linked), play a round or two, end it.
3. As **P**, reload the You tab: rating `______`, games `______`. Call this **AFTER**.
   ✅ the rating moved.
4. As **H**, You tab → Sessions (host tab) → select that session → delete it.
5. As **P**, reload the You tab. ✅ rating and games are back to **BEFORE**, exactly.
6. ✅ the rating trend sparkline lost that point — no stray bump.
7. ✅ the session is gone from P's Player tab and from the club league board.

**9b — delete an older session (subtract, not restore)**

1. As **H**, run and end **two** sessions with P, noting P's rating after each: S1 → `______`,
   S2 → `______`.
2. Delete **S1** (the older one).
3. ✅ P's rating = (rating after S2) − (S1's delta). If S1 gave +30, the number drops by 30.
   ✅ games drops by S1's game count.
4. ✅ RD/volatility are *not* restored — correct and intended. Glicko-2 is sequential, so removing
   a middle session exactly would need a full replay of every later session.

**9c — guards**

1. As **P**, try to delete one of H's sessions (via the console, as in block 7)
   ✅ "Only the host can delete this session."
2. As **H**, discard a **draft** lobby from Play ✅ deletes cleanly, no rating change.
3. As **H**, multi-select **three** sessions in the You tab and delete ✅ all three go, ✅ P's
   rating reflects all three reversals.

**Note on sessions deleted before 0040:** their history rows have no snapshot, so they fall back
to delta subtraction. Ratings inflated by a session you deleted *before* applying 0040 won't
self-heal — see the note at the end of this file.

---

## 10 · Account deletion (0037)

Use a **third throwaway account** for this — it's irreversible.

1. Have it join a session and a club, then Settings → Delete account → type DELETE.
2. ✅ signed out, back at the landing page.
3. As **H**, open that session's podium ✅ the player reads "Deleted player", ✅ the scores and
   everyone else's names are intact.
4. ✅ the club member list no longer shows them.
5. ✅ signing in with that email fails.
6. ✅ signing **up** with that email works — a fresh account, no old history.

---

## 11 · Legal pages (2901669)

1. As a **stranger**, open `/privacy` and `/terms` ✅ both render without an account.
2. ✅ the language toggle switches EN ⇄ ID and ✅ survives a reload.
3. ✅ the choice is shared with `/about` — switch on one, the other follows.
4. ✅ Settings → Legal links to both; ✅ sign-up shows the 18+ and consent line;
   ✅ the logged-out home footer has Privacy · Terms.
5. ✅ the "?" beside Rating on a profile opens `/about` **at the rating answer**, already expanded.
6. ✅ the "?" on the code screen opens the join-code answer.

---

## 12 · Regression sweep (things I touched that must be unchanged)

Fast pass, as **H**:

1. ✅ Create → lobby → join code → a player joins → accept → start. No change in behaviour.
2. ✅ Score entry, Next Round, End Session all behave as before.
3. ✅ Notifications still arrive and mark read.
4. ✅ Champions Hall and the club league still populate after ending a club session.
5. ✅ Settings: change name, bio, photo, password — all save.
6. ✅ Enter a code → live view → claim a spot → host accepts.

---

## What a pass looks like

Blocks 1–7 and 9 are the ones that were actually broken. If those pass and 12 shows nothing new
broken, this is shippable. Block 8 is polish you'll notice on a phone; blocks 10–11 are
lower-traffic paths worth one careful run each.

If a block fails, the note under it names the mechanism — quote that line back and it's a short
conversation rather than a re-diagnosis.

---

## Known, still open (not test failures)

These are documented gaps, not regressions. Don't file them twice.

- **A player who joins by code and is confirmed by the host is never linked to their account.**
  Their rating and record don't move. Only "Claim your spot" links. This is the next fix.
- **A failed rating/league write at session end is never retried.** If the host's connection drops
  for the two seconds after tapping End, that session silently never affects anyone's rating, and
  nothing re-attempts it.
- **Offline scores that permanently fail to sync still render as final** on the host's device
  while the server never saw them.
- **Deleting the last member of a club deletes the club**, taking ex-members' league history with it.
- The full list is in `padelier-final-review.md`.
