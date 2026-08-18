# The admin dashboard

`/admin`, in the app, on your phone. Added in `0041_admin.sql`.

---

## Turning it on

Two steps, once.

**1. Run the migration.** Paste `supabase/migrations/0041_admin.sql` into the Supabase SQL editor. It is
idempotent — running it twice is safe.

**2. Make yourself an admin.** There is deliberately no UI that creates the first admin, because a UI
that can grant admin to the person using it is not a permission system. So, in SQL:

```sql
update profiles
   set is_admin = true
 where id = (select id from auth.users where email = 'your@email');
```

After that a link appears in Settings, and `/admin` opens. Everyone else gets "Not found" — and, more
importantly, every admin function checks `is_admin` on the server, so a non-admin who forces the route
sees an empty shell and "Admins only." in place of data.

To make someone else an admin, use the button on their page in the dashboard. The last admin cannot
remove themselves.

---

## What each tab is for

**Overview** — the shape of the app. People, sessions, clubs, matches, a 21-day session bar, formats
actually being played, and how many errors are open.

**Health** — the important one. This app's failures are silent: RLS denies a read by returning an
empty result, and the rating write at the end of a session fails into a `console.warn` nobody reads.
Health asks the database directly for the shapes those failures leave behind:

| Check | What it means |
|---|---|
| Ended sessions that never got their ratings | `applySessionRatings` failed and was never retried. **Re-run finalize** fixes it in place. |
| Club sessions missing from the league | Same failure on the league write. Same button. |
| Ratings with no sessions behind them | `profiles.rating` is a snapshot; when every rated session is deleted it can survive alone. **Reset rating** on that person's page. |
| Rating history pointing at a deleted session | The FK nulls `session_id` rather than removing the row, leaving an untraceable bump on the trend line. |
| Players linked to an account with no join request | Their sessions exist and count toward their rating, but `get_player_sessions` looks for a *confirmed join request email*, and a claimed spot never files one — so the Player tab reads empty. |
| Sessions still live after a day | A host who closed the tab. Harmless, but each one holds a join code. |
| Draft sessions older than a week | Litter from abandoned create-wizard runs. |

"Re-run finalize" is safe to press twice: `apply_session_ratings` and `apply_session_results` are both
guarded by their own applied-flags, so a retry can't double-count anyone's rating or league points.

**People** — search by name or email; open anyone to see everything the database holds about them,
including a plain-English verdict on why their tabs look the way they do.

**Sessions** — every session with its host, club, player and account counts, rounds, scored matches,
and whether its rating and league writes actually landed.

**Errors** — client-side exceptions, grouped. Nothing captured these before 0041: there is now a React
error boundary around the whole app plus `window.onerror` and `unhandledrejection` hooks, all writing
through a rate-limited RPC. Expand a group for its stack; mark it resolved to file it away.

**Activity** — everything that happened, newest first, assembled from tables that already recorded it:
sessions created and ended, accounts, clubs, joins, score edits, claims, errors, and every admin
action.

---

## What it deliberately cannot do

No deleting sessions, clubs or accounts. No editing scores. No reading anyone's notifications — that is
personal correspondence and nothing here needs it.

The repairs it does allow are the reversible ones: reset a rating to a number the database still holds,
re-link a player to the right account, re-run a finalize, grant or revoke admin. Every one of them
writes an `admin_actions` row with the before and after values, so the dashboard can't change anything
without leaving a record of who changed it.

---

## What the error log stores

Route, message, stack, kind, app version, user agent, and the user id if signed in. No form values, no
message bodies, no email addresses. A flood guard caps it at 30 rows per account per minute, and the
client drops known noise (ResizeObserver loops, aborted fetches, cross-origin script errors) and
anything raised while offline.

Worth remembering for the privacy policy: this is a new category of personal data being processed, and
it is covered by the "usage data" line already in `/privacy`.


---

## Added in 0043

**A search box, always on screen.** Type a join code, a public token, a uuid, an email, a display name,
a club name or a club code — it resolves all of them and takes you to the object. Support conversations
don't arrive sorted by entity type, so neither does this.

**Live** — what is running this minute: which round each session is on, how many matches are scored and
still open, and *how long since anything happened*. That last number is the useful one. A live session
idle for 45 minutes is either finished with nobody pressing End, or a host who lost the tab, and it says
so. Refreshes itself every 30 seconds.

**Any session, all the way down.** Sessions and Live rows now open a full page: the session's identity
and both finalize flags, every player with the account they're linked to, every round and match with
scores, the rating rows the session wrote, its league rows, join requests, claims and score edits.

Two things are called out at the top rather than buried, because they're the two questions people
actually ask:

- *ended without writing its ratings or league rows* — the best-effort write failed and nothing retried
  it. **Re-run finalize** is right there.
- *linked to an account with no confirmed join request* — that person's games count toward their rating
  but the session will never appear in their Player tab, because `get_player_sessions` matches on a
  confirmed join request's email and a claimed spot never files one.

Repairs on this page: **Re-run finalize**, **Force end** for a session stuck live (it only moves the
status — ratings are computed on the client, so re-run finalize afterwards if it should count), and
**Unlink** on a player attached to the wrong account.

**Growth** answers whether people come back, which raw counts never do. Of everyone who signed up more
than a week ago: how many finished onboarding, played at all, played inside their first week, came back
for a second session, hosted something themselves. Accounts younger than a week are excluded — they
haven't had a fair chance, and counting them would flatter nobody. Below that, week-by-week signups,
sessions, active hosts and active players, then the list worth acting on: **signed up, never played**.

**Settings** writes the one row the whole app reads on load:

- an **announcement banner** on every screen including the signed-out ones, dismissible, with an
  optional expiry
- a **maintenance note**, which takes over the banner and always reads as urgent — it blocks nothing on
  purpose, because a session in progress must not be interrupted by a notice
- **pause new signups**, which makes the sign-up form refuse and explain

Be clear-eyed about that last one: it's enforced in the sign-up form, not in the database. It closes the
ordinary front door. It is not a lock, and the admin screen says so where you press it.
