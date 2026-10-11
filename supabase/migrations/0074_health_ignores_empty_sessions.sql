-- ---------------------------------------------------------------------
-- 0074_health_ignores_empty_sessions.sql
--
-- Admin -> Health counted sessions that could never be rated as "never got
-- their ratings": nights set up and abandoned (0 scored matches), and club
-- nights where nobody playing has an account in the club. Re-run finalize
-- does nothing for those, so the red number never went away and hid the
-- ones that matter. Both checks now require something to rate.
--
-- Read-only change to admin_health(); no data is touched. Safe to re-run.
-- ---------------------------------------------------------------------

create or replace function admin_health()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();

  with
  unrated as (
    select s.id, s.name, s.ended_at
      from sessions s
     where s.status = 'ended'
       and coalesce(s.ratings_applied, false) = false
       and exists (select 1 from players p where p.session_id = s.id and p.linked_user_id is not null)
       -- 0074: and something to rate. A night set up and abandoned has
       -- nothing a finalize could do, so it isn't a failure worth a red number.
       and exists (select 1 from matches m join rounds r on r.id = m.round_id
                    where r.session_id = s.id and m.status = 'final')
  ),
  no_results as (
    select s.id, s.name, s.ended_at
      from sessions s
     where s.status = 'ended'
       and s.club_id is not null
       and coalesce(s.results_applied, false) = false
       -- 0074: only when a league row could exist: a scored match, and at
       -- least one player who is an account in that club.
       and exists (select 1 from matches m join rounds r on r.id = m.round_id
                    where r.session_id = s.id and m.status = 'final')
       and exists (select 1 from players p
                     join club_members cm on cm.user_id = p.linked_user_id and cm.club_id = s.club_id
                    where p.session_id = s.id)
  ),
  ghost_rating as (
    select p.id, p.display_name, p.rating, p.rating_games,
           (select count(*) from rating_history rh
             where rh.user_id = p.id and rh.session_id is null) as orphan_rows
      from profiles p
     where p.deleted_at is null
       and p.rating_games > 0
       -- No history pointing at a session that still exists. A row whose
       -- session was deleted doesn't count as history — that was the bug in
       -- 0041's reset, and this check had the same blind spot.
       and not exists (
         select 1 from rating_history rh
          where rh.user_id = p.id and rh.session_id is not null
       )
  ),
  orphan_history as (
    select rh.id, rh.user_id, p.display_name, rh.rating, rh.delta, rh.created_at
      from rating_history rh
      left join profiles p on p.id = rh.user_id
     where rh.session_id is null
  ),
  unlinked_claim as (
    select pl.id, pl.display_name, pl.session_id
      from players pl
      join auth.users u on u.id = pl.linked_user_id
     where pl.linked_user_id is not null
       and not exists (
         select 1 from join_requests jr
          where jr.session_id = pl.session_id
            and jr.status = 'confirmed'
            and lower(jr.email) = lower(u.email)
       )
  ),
  stuck_live as (
    select s.id, s.name, s.started_at
      from sessions s
     where s.status = 'live'
       and coalesce(s.started_at, s.created_at) < now() - interval '24 hours'
  ),
  stale_draft as (
    select s.id, s.name, s.created_at
      from sessions s
     where s.status = 'draft'
       and s.created_at < now() - interval '7 days'
  )
  select jsonb_build_array(
    jsonb_build_object(
      'key', 'sessions_unrated', 'label', 'Ended sessions that never got their ratings',
      'why', 'applySessionRatings is best-effort and is never retried, so a failure here is silent — the session looks finished and nobody''s rating moved.',
      'count', (select count(*) from unrated),
      'sample', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from unrated order by ended_at desc limit 5) x)),
    jsonb_build_object(
      'key', 'sessions_results_missing', 'label', 'Club sessions missing from the league',
      'why', 'Same failure on the league write: the session counted for the league but no session_results rows exist, so the board silently omits it.',
      'count', (select count(*) from no_results),
      'sample', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from no_results order by ended_at desc limit 5) x)),
    jsonb_build_object(
      'key', 'rating_without_history', 'label', 'Ratings with no surviving session behind them',
      'why', 'profiles.rating is a snapshot. When every rated session is deleted the snapshot can survive — a number that corresponds to no game that still exists. Reset rating on that account rebuilds it from what''s left, which here means back to a new player.',
      'count', (select count(*) from ghost_rating),
      'sample', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from ghost_rating order by rating_games desc limit 5) x)),
    jsonb_build_object(
      'key', 'orphan_rating_history', 'label', 'Rating history pointing at a deleted session',
      'why', 'The FK nulls session_id instead of removing the row, leaving a bump on the trend line that traces back to nothing. Reset rating clears these for that account.',
      'count', (select count(*) from orphan_history),
      'sample', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from orphan_history order by created_at desc limit 5) x)),
    jsonb_build_object(
      'key', 'claim_without_join_request', 'label', 'Players linked to an account with no join request',
      'why', 'get_player_sessions finds sessions by CONFIRMED JOIN REQUEST EMAIL. A player who tapped "claim your spot" has a linked account but no join request, so the session never appears in their Player tab even though it counts toward their rating.',
      'count', (select count(*) from unlinked_claim),
      'sample', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from unlinked_claim limit 5) x)),
    jsonb_build_object(
      'key', 'sessions_stuck_live', 'label', 'Sessions still live after a day',
      'why', 'Almost always a host who closed the tab. Harmless, but they clutter every list and keep their join code alive.',
      'count', (select count(*) from stuck_live),
      'sample', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from stuck_live order by started_at limit 5) x)),
    jsonb_build_object(
      'key', 'stale_drafts', 'label', 'Draft sessions older than a week',
      'why', 'The create wizard mints a draft to hold a join code. Abandoned ones are litter, and each one holds a code out of circulation.',
      'count', (select count(*) from stale_draft),
      'sample', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from stale_draft order by created_at limit 5) x))
  ) into v;
  return v;
end;
$$;
