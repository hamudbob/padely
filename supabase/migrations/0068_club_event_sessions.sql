-- ---------------------------------------------------------------------
-- 0068_club_event_sessions.sql
--
-- The club page told members a live session was still an RSVP.
--
-- The club card decides "this event is live now" by reading the session
-- started from it. It read the sessions TABLE — and since 0021 the only
-- select policy on sessions is host_all_sessions (created_by = auth.uid()).
-- So the host saw "Live", and every other member saw no session at all,
-- which the card renders as the RSVP form for a night already under way.
--
-- The event page never had this bug: get_public_event (0056) is SECURITY
-- DEFINER and returns the same four fields. This is the club card's
-- equivalent, scoped the same way and no wider:
--
--   - only sessions that a club event points at,
--   - only for clubs the caller is a member of,
--   - only id, status, public_token, join_code — never the whole row.
--
-- join_code is included deliberately, matching get_public_event: the card's
-- "Join" goes straight to /live/<token>?j=<code>, and a join still needs the
-- host to accept it.
-- ---------------------------------------------------------------------

create or replace function get_club_event_sessions(p_session_ids uuid[])
returns table (id uuid, status text, public_token text, join_code text)
language sql stable security definer set search_path = public as $$
  select distinct s.id, s.status, s.public_token, s.join_code::text
    from sessions s
    join club_events e on e.session_id = s.id
   where s.id = any(p_session_ids)
     and is_club_member(e.club_id);
$$;

revoke all on function get_club_event_sessions(uuid[]) from public, anon;
grant execute on function get_club_event_sessions(uuid[]) to authenticated;
