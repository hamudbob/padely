# What's left

Written 26 Aug 2026, from a working session. Ordered by what I'd do next, not by
size. Anything marked **bug** is provably wrong in the code today, not a
preference — those come first because they quietly undo work that's already
shipped.

---

## Blockers outside the code

- **padelier.id doesn't resolve.** Google's public resolver returns NXDOMAIN for
  A, NS and SOA, while the `.id` TLD answers normally — so the name isn't in the
  registry zone at all. That's expiry, a removed delegation, or a registrar
  suspension, not Netlify and not DNS propagation. Everything else on this list
  is downstream of it: the app is unreachable, the confirmation and reset emails
  point at a dead host, and App Review clicks the support URL.
- **Migrations 0046, 0047 and 0048 to run.** All idempotent; re-running is free.
  The check-what's-applied query is in the session notes — or just run them.
- **Two commits unpushed** as of writing.

---

## Bugs

### A claimed session never appears in that player's own tab — **bug**
`get_player_sessions` still matches on a *confirmed join request by email* (the
0006 version). Claiming a spot doesn't file one, so someone who claims their
name — or who an admin links after the fact — plays a whole session that never
shows in their list. Their record, rating and partner stats DO include it
(`get_my_participation` matches on `linked_user_id`), so the profile can say "12
sessions" above a list of 11.

*Fix:* one migration — match `players.linked_user_id = auth.uid()` as well as
the email route. No client change.

### The admin "Credit rating" button is offered when it can't work — **bug**
`/admin/s/<id>` shows it for every linked player on an ended, rated session,
without checking whether that person was already rated normally at session end —
which is nearly everyone. The RPC refuses correctly (a `rating_history` row for
that pair already exists), so nothing double-counts, but the button is wrong
95% of the time and only proves it after a tap.

*Fix:* `admin_session_detail` returns a per-player "already rated for this
session" flag; the row shows "rating counted ✓" and the button appears only for
someone who genuinely missed out.

### The mix fairness cap is unimplemented and its test is red
`balancePoolByKey` swaps players to even the gender split no matter what it
costs rest fairness. With 6 men and 5 women on 2 courts the women play every
round and the spread hits 2 where the test wants ≤1. Decision already taken: cap
the unfairness — before each swap, check whether it would push someone's
play-count gap past a limit, and if so accept one same-gender pair that round.

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
Play requires a web route for deletion requests *in addition* to the in-app one,
for people who've uninstalled. Most of the text already exists in the retention
section of the privacy policy.

### The going list is public
A signed-out visitor to `/e/<id>` sees eight members' names and photos. Proposal:
signed-out sees counts and first names only; members see faces.

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

### A club's past sessions
The Champions Hall's recent-champions rows should link through to
`/session/<id>/final` (already public for any non-draft session), and the club
page should carry a "Past sessions" block — last five with date, format and
winner, plus "See all".

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
