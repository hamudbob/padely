-- ---------------------------------------------------------------------
-- 0042_orphan_rating_history.sql
--
-- Fixes a bug in 0041's "Reset rating": it treated an ORPHANED rating_history
-- row as real history and restored the broken value it was asked to clear.
--
-- WHAT HAPPENED. rating_history.session_id is ON DELETE SET NULL. When a
-- session was deleted before 0040 existed — or by any path other than
-- delete_session_and_unrate — the history row survived with a null
-- session_id: a rating change that traces back to no session that exists.
--
-- The account we found this on reads 1324 over 7 games, with exactly one such
-- row: "deleted session, 1324, -176". Its true state is a player who has
-- never had a rated session: 1500 / 350 / 0.06 / 0 games. But 0041 asked
-- "are there any history rows?", found one, took the from_history branch, and
-- wrote back 1324 over 7 games — a faithful restoration of the problem.
--
-- THE RULE, stated once: a rating_history row with a null session_id is not
-- evidence of anything. It is only reachable through the trend line, where it
-- shows as a bump nobody can explain. Three things follow:
--
--   * the reset decides on LIVE rows only (session_id is not null)
--   * the reset DELETES the orphans it finds, so the trend line stops lying —
--     their full contents go into the admin_actions row first, so the change
--     is reversible from the log
--   * the health check counts accounts with no LIVE history, not accounts
--     with no rows at all, so this shape is findable instead of hiding
--
-- Note the boundary of 0040: it removes history rows for the session it
-- deletes, so no NEW orphans are created. This is entirely about the ones
-- already there.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

create or replace function admin_reset_user_rating(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before   profiles%rowtype;
  v_after    profiles%rowtype;
  v_last     rating_history%rowtype;
  v_orphans  jsonb;
  v_orphan_n integer := 0;
  v_mode     text;
begin
  perform admin_guard();
  select * into v_before from profiles where id = p_user_id;
  if not found then raise exception 'No such account.' using errcode = 'P0002'; end if;

  -- Keep a full copy of what is about to be removed. This is the only reason
  -- deleting rows from here is acceptable: the admin_actions row below holds
  -- everything needed to put them back by hand.
  select coalesce(jsonb_agg(to_jsonb(rh)), '[]'::jsonb), count(*)
    into v_orphans, v_orphan_n
    from rating_history rh
   where rh.user_id = p_user_id and rh.session_id is null;

  -- The decision is made on LIVE history only.
  select * into v_last
    from rating_history
   where user_id = p_user_id
     and session_id is not null
   order by created_at desc, id desc
   limit 1;

  if not found then
    v_mode := 'defaults';
    update profiles set
      rating            = 1500,
      rating_deviation  = 350,
      rating_volatility = 0.06,
      rating_games      = 0,
      updated_at        = now()
    where id = p_user_id;
  else
    v_mode := 'from_history';
    update profiles set
      rating       = v_last.rating,
      rating_games = coalesce(v_last.games_after, rating_games),
      updated_at   = now()
    where id = p_user_id;
  end if;

  if v_orphan_n > 0 then
    delete from rating_history where user_id = p_user_id and session_id is null;
  end if;

  select * into v_after from profiles where id = p_user_id;

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), 'reset_rating', 'user', p_user_id, jsonb_build_object(
    'mode', v_mode,
    'orphans_removed', v_orphan_n,
    'orphans', v_orphans,
    'before', jsonb_build_object('rating', v_before.rating, 'rd', v_before.rating_deviation,
                                 'vol', v_before.rating_volatility, 'games', v_before.rating_games),
    'after',  jsonb_build_object('rating', v_after.rating, 'rd', v_after.rating_deviation,
                                 'vol', v_after.rating_volatility, 'games', v_after.rating_games)));

  return jsonb_build_object(
    'mode', v_mode,
    'rating', v_after.rating,
    'games', v_after.rating_games,
    'orphans_removed', v_orphan_n);
end;
$$;

comment on function admin_reset_user_rating(uuid) is
  'Rebuilds a rating from what still exists. Rows whose session was deleted (session_id is null) are ignored for the decision and removed, with their contents copied into admin_actions first. No live history left means the account is put back to a new player: 1500 / 350 / 0.06 / 0 games.';

-- --- The health check has to look for the same thing --------------------
-- Only the rating_without_history entry changes: "no history at all" becomes
-- "no history that points at a session that still exists", and the sample
-- carries the orphan count so the shape is obvious from the list.
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
  ),
  no_results as (
    select s.id, s.name, s.ended_at
      from sessions s
     where s.status = 'ended'
       and s.club_id is not null
       and coalesce(s.results_applied, false) = false
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

-- --- And the account page needs to be able to tell them apart -----------
-- Adds history_live alongside history_rows, so the verdict can say "no
-- surviving history" rather than "no history" — the distinction this whole
-- migration is about.
create or replace function admin_user_detail(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select jsonb_build_object(
    'profile', (
      select to_jsonb(x) from (
        select p.id, p.display_name, u.email, p.avatar_url, p.bio, p.rating, p.rating_deviation,
               p.rating_volatility, p.rating_games, p.is_admin, p.onboarded_at, p.deleted_at,
               p.created_at, p.updated_at
          from profiles p left join auth.users u on u.id = p.id
         where p.id = p_user_id
      ) x),
    'diagnosis', (
      select jsonb_build_object(
        'linked_player_rows',      (select count(*) from players pl where pl.linked_user_id = p_user_id),
        'confirmed_join_requests', (select count(*) from join_requests jr
                                      join auth.users u2 on u2.id = p_user_id
                                     where jr.status = 'confirmed' and lower(jr.email) = lower(u2.email)),
        'history_rows',            (select count(*) from rating_history rh where rh.user_id = p_user_id),
        'history_live',            (select count(*) from rating_history rh
                                     where rh.user_id = p_user_id and rh.session_id is not null),
        'history_orphaned',        (select count(*) from rating_history rh
                                     where rh.user_id = p_user_id and rh.session_id is null),
        'sessions_hosted',         (select count(*) from sessions s where s.created_by = p_user_id),
        'league_rows',             (select count(*) from session_results sr where sr.user_id = p_user_id)
      )),
    'rating_history', (
      select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc), '[]'::jsonb)
        from (select rh.id, rh.session_id, s.name as session_name, rh.rating, rh.delta,
                     rh.rating_before, rh.games_before, rh.games_after, rh.created_at
                from rating_history rh
                left join sessions s on s.id = rh.session_id
               where rh.user_id = p_user_id
               order by rh.created_at desc limit 25) h),
    'sessions', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
        from (
          select s.id, s.name, s.format, s.status, s.created_at, s.ended_at,
                 (s.created_by = p_user_id) as hosted,
                 coalesce(s.ratings_applied, false) as ratings_applied,
                 coalesce(s.results_applied, false) as results_applied
            from sessions s
           where s.created_by = p_user_id
              or exists (select 1 from players pl where pl.session_id = s.id and pl.linked_user_id = p_user_id)
           order by s.created_at desc limit 25) t),
    'clubs', (
      select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        from (select cl.id, cl.name, cm.role, cm.joined_at
                from club_members cm join clubs cl on cl.id = cm.club_id
               where cm.user_id = p_user_id) c),
    'errors', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
        from (select ce.id, ce.kind, ce.message, ce.route, ce.created_at
                from client_errors ce where ce.user_id = p_user_id
               order by ce.created_at desc limit 10) e),
    'admin_actions', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
        from (select aa.action, aa.detail, aa.created_at
                from admin_actions aa where aa.target_id = p_user_id
               order by aa.created_at desc limit 10) a)
  ) into v;
  return v;
end;
$$;
