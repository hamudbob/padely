-- ---------------------------------------------------------------------
-- Backfill league rows for players who were linked AFTER a session ended
--
-- WHY THIS IS NEEDED, and why there is nothing to "insert" by hand.
--
-- session_results is written only by apply_session_results(), and the rows it
-- writes are computed on the CLIENT by applySessionResults() in
-- src/lib/supabase/resultActions.ts — from assembleStandings, the same
-- function the live table uses. The server stores; it does not calculate.
--
-- That client function decides who gets a row by reading, at the moment it
-- runs:
--
--     players.linked_user_id   — the player must be attached to an account
--     club_members             — that account must be a CURRENT club member
--
-- Both are read live. So a player who was unlinked on the night is simply
-- absent from the payload, and linking them later changes nothing on its own,
-- because nothing re-runs.
--
-- The one thing standing in the way of a re-run is this, in
-- apply_session_results (0041):
--
--     if v_applied then return; end if;
--
-- So the fix is NOT to craft INSERTs. Hand-writing a session_results row means
-- hand-computing rank, field_size, placement_points, podium_bonus and perf_adj
-- — perf_adj especially, which is an opponent-adjusted Glicko expectation, not
-- something to eyeball. Get one wrong and the league is quietly incorrect
-- forever, with no error to notice.
--
-- Instead: clear the once-only flag and let the app recompute the whole
-- session. It deletes and rewrites every row for that session from live data,
-- so the ten players who are already correct come out identical, and the two
-- who were missing appear with numbers computed the same way as everyone
-- else's.
--
-- ⚠️  DO NOT ALSO CLEAR ratings_applied.
--
--     Results are safe to recompute; RATINGS ARE NOT. apply_session_ratings
--     writes ABSOLUTE rating values that the client derived from each player's
--     rating AS IT IS NOW. Those ratings already moved when the session ended.
--     Re-running would compute a fresh delta from the already-updated number
--     and apply it on top — every player rated twice for one night, plus a
--     duplicate rating_history row each. There is no undo short of
--     delete_session_and_unrate (0040).
--
--     The consequence, stated plainly: the two players get their LEAGUE rows
--     back, but they get no rating change for that session. That is the safe
--     trade. Leave it alone.
--
-- NOTE ON RATINGS FOR THIS SPECIFIC CASE (8 Sep 2026):
-- Hamzah and Hanif already had their ratings credited via the admin console's
-- "Credit rating" button — admin_credit_session_rating (0047), which credits
-- one account for one session and refuses if a rating_history row already
-- exists for the pair. That is the correct per-player repair and it leaves
-- ratings_applied alone. Nothing below disturbs it.
--
-- The gap this file works around: ratings HAVE a per-player repair; league
-- rows do not. There is no "credit league row" equivalent, so the only route
-- is a whole-session recompute. See the end of this file.
--
-- Run the steps in order. Steps 1-3 only read.
-- ---------------------------------------------------------------------


-- ── STEP 1 ── Find the session, and confirm the accounts are linked ──
--
-- Expect one row per player. `player_id` NOT NULL is the proof that the admin
-- console's link actually landed. If either row shows a null player_id, the
-- link did not save and nothing below will help — fix the link first.

select u.email,
       u.id                as user_id,
       p.id                as player_id,
       p.display_name      as played_as,
       p.status            as player_status,
       s.id                as session_id,
       s.name              as session_name,
       s.ended_at,
       s.club_id,
       s.counts_for_league,
       s.results_applied
  from auth.users u
  left join players  p on p.linked_user_id = u.id
  left join sessions s on s.id = p.session_id
 where u.email in ('hamzahbhnn@gmail.com', 'hanifomaaar@gmail.com')
 order by s.ended_at desc nulls last;

-- Copy the session_id of last night's session for the steps below.
-- Check while you are here:
--   club_id           must NOT be null  — a session with no club has no league
--   counts_for_league must be true      — set false means it was excluded on purpose
--   results_applied   is almost certainly true, which is what blocks the re-run


-- ── STEP 2 ── The condition most likely to still bite ────────────────
--
-- Linking an account is NOT the same as joining the club. resultActions.ts
-- writes a row only for accounts in club_members for that session's club:
--
--     if (memberByPlayer.size === 0) return;
--
-- If is_club_member comes back false, add them to the club FIRST (admin
-- console, or the club's own invite flow). Otherwise the recompute will run
-- happily and still skip them, and it will look like this whole exercise
-- failed for no reason.

select u.email,
       s.club_id,
       (cm.user_id is not null) as is_club_member
  from auth.users u
  join players  p  on p.linked_user_id = u.id
  join sessions s  on s.id = p.session_id
  left join club_members cm on cm.club_id = s.club_id and cm.user_id = u.id
 where u.email in ('hamzahbhnn@gmail.com', 'hanifomaaar@gmail.com')
   and s.id = '568c250c-2c89-42c1-b1e4-31878aa12f57';  -- Plr padel night, ended 7 Sep 2026


-- ── STEP 3 ── What the league holds for this session right now ───────
-- Note the row count. It should grow by exactly 2 at the end.

select sr.rank, pr.display_name, sr.placement_points, sr.podium_bonus,
       sr.wins, sr.losses, sr.scored_points, sr.perf_adj
  from session_results sr
  join profiles pr on pr.id = sr.user_id
 where sr.session_id = '568c250c-2c89-42c1-b1e4-31878aa12f57'
 order by sr.rank;


-- ── STEP 4 ── Unlock the recompute (the only write in this file) ─────
--
-- Single session, by id. Never run this without a WHERE clause: clearing the
-- flag across the table would leave every past session re-finalizable, and a
-- later stray tap would rewrite league history from today's club membership
-- rather than the membership of the night in question.

update sessions
   set results_applied = false
 where id = '568c250c-2c89-42c1-b1e4-31878aa12f57';


-- ── STEP 5 ── Now do this in the app, not in SQL ─────────────────────
--
--   Admin console -> Sessions -> that session -> "Finalize" (it appears once
--   results_applied is false, and it will now read "missing from league").
--
--   The button calls applySessionRatings then applySessionResults. The ratings
--   call is a no-op — ratings_applied is still true and the RPC returns early.
--   That is exactly what we want, and it is why Step 4 touches one flag only.


-- ── STEP 6 ── Verify, then stop ──────────────────────────────────────
-- Re-run STEP 3. Expect the same players with the same numbers, plus Hamzah
-- and Hanif slotted in at their real ranks. Then confirm the flag went back up
-- on its own:

select id, name, results_applied, ratings_applied
  from sessions
 where id = '568c250c-2c89-42c1-b1e4-31878aa12f57';
-- results_applied should be true again, ratings_applied untouched (true).


-- ---------------------------------------------------------------------
-- THE REAL FIX, once this is unblocked
--
-- Reaching into the database to clear a flag is not a procedure anyone should
-- have to remember, and this is the second repair of the same shape: a player
-- claimed their spot too late, so the once-only write that had already run
-- excluded them. Ratings solved it in 0047 with admin_credit_session_rating —
-- narrow, idempotent, refuses if the work is already done, and reachable from
-- a button.
--
-- session_results deserves the same treatment. Two options, in order of
-- preference:
--
--   1. Widen the existing repair. The admin console already shows "Credit
--      rating" against an account that played but was not rated. The same
--      situation nearly always means the league row is missing too, so the
--      button should offer both — one action for "this person played, make the
--      record reflect it".
--
--   2. Failing that, an admin_recompute_session_results(session_id) RPC that
--      clears the flag and lets the client re-submit, so the operation lives
--      behind admin_guard() with an audit trail rather than in a hand-run
--      UPDATE that could lose its WHERE clause.
--
-- Tracked in docs/BACKLOG.md.
-- ---------------------------------------------------------------------
