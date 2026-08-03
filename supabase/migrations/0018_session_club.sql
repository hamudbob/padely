-- ---------------------------------------------------------------------
-- 0018_session_club.sql  (Phase 3 — attribute a session to a team/club)
--
-- A session can optionally belong to ONE club (the new teams feature from
-- 0014). This is what a club's league + leaderboard will later aggregate
-- over. Nullable & additive: every existing session (and every ad-hoc
-- session going forward) simply has club_id = null and behaves exactly as
-- before. On delete of a club we keep the sessions but null the link
-- (set null) — a session's scores/history are the host's, not the club's,
-- so they must survive the club being disbanded.
--
-- RLS: the host already has full read/write via host_all_sessions (0001).
-- This adds a SELECT-only policy so a club's members can see the sessions
-- attached to their club — the "team sessions" list + league feed. Members
-- get read of the session ROW only (name/status/dates/join_code); all the
-- detail tables (players/matches/…) stay host-only, and the public
-- read-only view still goes through get_public_session's SECURITY DEFINER
-- path. is_club_member() is defined in 0014_teams.sql.
-- Additive & safe to re-run.
-- ---------------------------------------------------------------------

alter table sessions
  add column if not exists club_id uuid references clubs(id) on delete set null;

create index if not exists sessions_club_id_idx on sessions (club_id);

drop policy if exists club_members_read_sessions on sessions;
create policy club_members_read_sessions on sessions
  for select to authenticated
  using (club_id is not null and is_club_member(club_id));
