# What's left

Written 26 Aug 2026, corrected 24 Aug after the Google sign-in session. Ordered by what I'd do next, not by
size. Anything marked **bug** is provably wrong in the code today, not a
preference — those come first because they quietly undo work that's already
shipped.

---

## Blockers outside the code

- ~~**padelier.id doesn't resolve.**~~ Fixed. NS, A, TXT and SOA all answer now,
  which unblocked Google's domain verification and the OAuth redirect URIs.
- ~~**Migrations 0046–0051 to run.**~~ Run.
- ~~**Commits unpushed.**~~ Pushed.

---

## Bugs

### ~~A claimed session never appears in that player's own tab~~ — fixed
Migration 0049: `get_player_sessions` now matches `players.linked_user_id =
auth.uid()` as well as the old confirmed-join-request-by-email route.

### ~~The admin "Credit rating" button is offered when it can't work~~ — fixed
Migration 0049: `admin_session_detail` returns `rated_for_session` per player;
the row shows "rating counted ✓" and the button only appears for someone who
genuinely missed out. (0049's rewrite also dropped five keys from that payload
and broke the admin page outright — repaired in 0050.)

### ~~The mix fairness cap is unimplemented and its test is red~~ — done
`balancePoolByKey` now refuses a swap that would push any player's game count
more than `MAX_PLAY_GAP` (1) ahead of another's, and accepts a same-key pair
that round instead.

It was worse than this entry said. The 6M/5F case in the test drifts to a spread
of 2 over ten rounds, but 8M/4F on two courts over twenty rounds reached **10** —
all four women on court every single round while men sat out half the night.
Measured across 942 runs (rosters 4–16 players, 1–3 courts, six seeds), the
spread after the cap never exceeds 1.

The price, measured on the same runs: on lopsided rosters some teams are now
same-gender — 8M/4F drops from 100% to ~70% mixed, 6M/5F to ~93%. Evenly split
rosters are untouched at 100%, and rosters where the mix was already limited by
the roster itself (5M/3F, 9M/3F) are unchanged. A cap of 2 was measured as an
alternative: it buys 2–3 percentage points of mix and allows a spread of 2.

---

## Policy and store requirements

### Report and block
Both stores require it and the app has neither. `/u/<id>` is a public page with a
stranger's photo and free-text bio. Apple's 1.2 wants filtering, reporting,
blocking and published contact — we have the last one.

Agreed semantics: block is **content and contact, not presence**. A blocked
person's photo and bio render as "Player", they leave your partner/rival lists,
they can't invite you to a club, and neither appears in the other's search. It
does NOT remove them from a session you're both in — the draw is untouched and
names stay on the scoreboard, because two people who both turned up are on the
same court whatever the database thinks. A block is invisible to everyone except
the blocker, including the host.

### A public /delete-account page
NOT more deletion logic — `delete_my_account` has shipped since 0037 and the
in-app route works. What's missing is a **public web page**: Play requires a URL
someone can reach *after uninstalling*, where they can request deletion and read
what gets erased, and the listing has to link to it. Apple doesn't require the
page, only the in-app route. Most of the text already exists in the retention
section of the privacy policy.

### ~~The going list is public~~ — decided, leaving it
A signed-out visitor to `/e/<id>` sees members' names and photos. Hamud's call,
26 Aug: no different from any club page on any booking site where you can open a
session and see who's playing. Not changing it.

---

## Features

### Push notifications
The one that would change how the club uses the app: an hour before a session,
and when a session starts. Needs, in order: a **service worker** (there is none —
which is also why the app shell won't load with no signal), a push subscriptions
table, VAPID keys, and a Supabase Edge Function woken by pg_cron. Works on
Android Chrome, and on iOS only for people who've added the app to their home
screen. Two to three days.

### An offline app shell
The score queue keeps entries safe while the app is open; if the tab is
discarded or reloaded on a court with no signal, nothing loads at all. A
shell-only service worker (cache the built assets, never cache Supabase calls)
closes the gap between what `/f/offline` promises and what happens.

### Per-court scoring
On three courts, one phone walking between them is the bottleneck of every
night. Let the host hand one court to a player who can enter that court's score
and nothing else. A court still has exactly one scorer, so the "one source of
truth" rule holds.

### ~~A club's past sessions~~ — done
Champions Hall rows link through to `/session/<id>/final`, and the club page
carries a Past sessions block (date, format, winner). `get_club_sessions` gained
`winner_name` and `field_size` in 0049.

### Clear all notifications
"Mark all as read" as the everyday action, "Clear read" to actually delete, so
nobody wipes an unread invite by reflex.

### Custom scoring amount
Parked pending arithmetic. The rule as described divides a sum over *games* by a
count of *rounds*, which makes the compensation scale with how many courts you
run — the same night on 3 courts gives a bigger top-up per missed game than on
2. The worked example's total didn't reconcile either (the losing scores in it
sum to 26, not 22).

---

### ~~Sign in with Google~~ — shipped. Apple still to come.
Google is live: OAuth client in Google Cloud, provider enabled in Supabase, a
Continue with Google button under the email field, and 0051 teaching
handle_new_user() to read `full_name` and the provider photo. The consent screen
carries the Padelier mark, so the app is published to production and the domain
is verified in Search Console.

**Identity linking: proven.** Signed up with a password, signed out, signed in
with a password, signed out, signed in with Google — same account, same uploaded
avatar, same name. Supabase Users shows a single row for that address with both
Email and Google under Providers. The duplicate-account failure mode (a second
account with no rating, no clubs, no history) does not occur.

**Open, and the mirror of the above:** someone who signs up with GOOGLE first and
later types their email on the login screen is asked for a password they never
set, and told "that password didn't work" — true, and useless. It is recoverable
through Forgot password (setting one adds an email identity alongside Google),
but the wording points away from the fix. Cheapest remedy: show Continue with
Google on the password step too, so the door they need is visible. This will be
most Google users eventually, since nobody remembers which button they used the
first time.

Apple is the other half and is **not optional once Google exists on iOS**:
guideline 4.8 requires an equivalent private login wherever a third-party one is
offered. It costs the developer account, a Services ID, a key and its own domain
verification — so it lands with the App Store push, not before.

## Smaller

- **The schedule form's time still defaults to empty**, which on some phones
  lands on "now" — that's how a 10:26 PM Sunday session got created. Default to
  the club's usual hour, or to the time of its last session.
- **RLS helpers don't check `deleted_at`**, so a banned user's live token keeps
  working until it expires.
- **`fixed-position` vs `fixed-partner`, and `mexicano` vs `mix-mexicano`** are
  hard to tell apart at card size — all four are dots on a court differing only
  in which are gold.
- **Housekeeping on the Mac:** `_to_delete/` and `_git_stale_locks/` in the repo
  folder. Git wouldn't let me remove them.
