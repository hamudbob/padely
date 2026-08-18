-- ---------------------------------------------------------------------
-- 0041_admin.sql — a super-admin view of the whole app, and the small set
-- of repairs that are safe to make from a phone.
--
-- WHY THIS EXISTS. Every bug in this app so far has been invisible from the
-- inside: RLS denies a read by returning an empty result, a rating write at
-- the end of a session fails and is swallowed by a .catch(console.warn), a
-- player's account is linked to a session by one path and looked up by
-- another. None of that shows up as an error anywhere — it shows up as a
-- screen with nothing on it, days later, if someone happens to mention it.
--
-- So this migration adds three things:
--
--   1. An ADMIN FLAG and an admin's read access to the operational tables,
--      so one account can see what every other account sees.
--   2. An ERROR LOG the client writes to, because until now nothing captured
--      a client-side exception at all.
--   3. HEALTH CHECKS — queries that look for the exact silent-failure shapes
--      this codebase has produced before, so they're findable in one screen
--      instead of by someone reporting a symptom.
--
-- The repairs deliberately stop short of destruction. An admin can put a
-- rating back, re-link a mis-claimed player, and re-run a session's finalize;
-- an admin cannot delete anyone's sessions, clubs or account from here. Every
-- repair writes an admin_actions row with the before and after values.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

-- --- 1. Who is an admin ------------------------------------------------
alter table profiles add column if not exists is_admin boolean not null default false;

comment on column profiles.is_admin is
  'Grants the /admin dashboard. Set it in SQL only — there is deliberately no UI that creates the first admin.';

-- SECURITY DEFINER so it can read profiles regardless of the caller's own
-- policies, and so it can be used INSIDE policies without recursing.
create or replace function is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;

-- Raises rather than returning an empty result. Everything else in this
-- schema fails closed by returning nothing, which is exactly the behaviour
-- that made the last three bugs invisible; an admin screen should say
-- "you are not an admin" out loud.
create or replace function admin_guard()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_app_admin() then
    raise exception 'Admins only.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function is_app_admin() from anon;
revoke all on function admin_guard() from anon;
grant execute on function is_app_admin() to authenticated;
grant execute on function admin_guard() to authenticated;

-- --- 2. A paper trail for everything an admin changes ------------------
create table if not exists admin_actions (
  id          bigserial primary key,
  admin_id    uuid not null references auth.users(id),
  action      text not null,
  target_type text,
  target_id   uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_actions_created_idx on admin_actions (created_at desc);

alter table admin_actions enable row level security;
drop policy if exists admin_read_actions on admin_actions;
create policy admin_read_actions on admin_actions for select using (is_app_admin());
-- No insert/update/delete policy: rows appear only via the SECURITY DEFINER
-- repair functions below, so the log can't be written selectively or edited.

-- --- 3. The error log --------------------------------------------------
create table if not exists client_errors (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete set null,
  kind        text not null,   -- 'error' | 'rejection' | 'boundary' | 'query'
  message     text not null,
  stack       text,
  route       text,
  app_version text,
  user_agent  text,
  context     jsonb,
  -- Grouping key: same kind + route + message shape = one row in the UI with
  -- a count, rather than four hundred identical lines.
  fingerprint text not null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists client_errors_created_idx on client_errors (created_at desc);
create index if not exists client_errors_group_idx on client_errors (fingerprint, created_at desc);
create index if not exists client_errors_open_idx on client_errors (resolved_at) where resolved_at is null;

alter table client_errors enable row level security;
drop policy if exists admin_read_errors on client_errors;
create policy admin_read_errors on client_errors for select using (is_app_admin());
-- Nobody can INSERT directly either — reports come through the function
-- below, which clamps every field and rate-limits. An open insert policy on a
-- table anon can reach is a free disk-fill.

create or replace function report_client_error(
  p_kind        text,
  p_message     text,
  p_stack       text default null,
  p_route       text default null,
  p_app_version text default null,
  p_user_agent  text default null,
  p_context     jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_msg    text;
  v_recent integer;
begin
  -- A reporter must never throw: an exception here would be raised inside
  -- the app's own error handler, and an error handler that errors takes the
  -- page down. Every bad input is dropped silently instead.
  if p_kind is null or p_kind not in ('error', 'rejection', 'boundary', 'query') then
    return;
  end if;
  v_msg := left(coalesce(nullif(btrim(p_message), ''), 'Unknown error'), 500);

  -- Flood guard. A render loop can fire thousands of identical errors a
  -- second; 30 per minute per account is enough to diagnose and small enough
  -- that a loop can't fill the table.
  select count(*) into v_recent
    from client_errors
   where created_at > now() - interval '1 minute'
     and user_id is not distinct from v_uid;
  if v_recent >= 30 then
    return;
  end if;

  insert into client_errors (
    user_id, kind, message, stack, route, app_version, user_agent, context, fingerprint
  ) values (
    v_uid,
    p_kind,
    v_msg,
    left(p_stack, 4000),
    left(p_route, 200),
    left(p_app_version, 60),
    left(p_user_agent, 300),
    p_context,
    md5(p_kind || coalesce(left(p_route, 120), '') || left(v_msg, 160))
  );
end;
$$;

-- Anon too: the errors most worth catching happen on the public pages —
-- /live/:token, a shared podium, the join screen — where nobody is signed in.
grant execute on function report_client_error(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- --- 4. An admin can read the operational tables -----------------------
-- Not a blanket grant: the tables below are the ones that describe a session
-- and its aftermath. `notifications` is deliberately NOT included — it is
-- personal correspondence and nothing in the dashboard needs it.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'players', 'rounds', 'matches', 'match_participants', 'courts', 'pairs',
    'round_rests', 'adjustments', 'score_edits', 'session_results', 'rating_history',
    'join_requests', 'player_claims', 'club_members', 'clubs', 'club_join_requests',
    'club_events', 'club_event_rsvps', 'club_invites', 'audit_events', 'teams'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists admin_read_all on public.%I', t);
      execute format('create policy admin_read_all on public.%I for select using (is_app_admin())', t);
    end if;
  end loop;
end;
$$;

-- --- 5. Let an admin re-run a session's finalize -----------------------
-- The two writes that happen after "End session" are best-effort and are not
-- retried; when they fail the session is ended but unrated, and nobody is
-- told. The client can recompute and resubmit — it is the same code path the
-- host used — but both RPCs are host-only. Widen them to "host OR admin",
-- keeping every other line as it was.
--
-- Reproduced in full because create-or-replace replaces the whole body: the
-- ratings version is 0040's, the results version is 0021's.
create or replace function apply_session_ratings(p_session_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_applied boolean;
  u jsonb;
  v_before  profiles%rowtype;
begin
  select status, coalesce(ratings_applied, false) into v_status, v_applied
    from sessions where id = p_session_id;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not (is_session_host(p_session_id) or is_app_admin()) then
    raise exception 'Only the host can apply ratings for this session.' using errcode = 'P0001';
  end if;
  if v_status <> 'ended' then
    raise exception 'Ratings apply only once a session has ended.' using errcode = 'P0001';
  end if;
  if v_applied then return; end if;

  for u in select value from jsonb_array_elements(p_updates) as value loop
    if not exists (
      select 1 from players
      where session_id = p_session_id and linked_user_id = (u->>'user_id')::uuid
    ) then
      continue;
    end if;

    select * into v_before from profiles where id = (u->>'user_id')::uuid;

    update profiles set
      rating            = (u->>'rating')::numeric,
      rating_deviation  = (u->>'rd')::numeric,
      rating_volatility = (u->>'vol')::numeric,
      rating_games      = (u->>'games')::int,
      updated_at        = now()
    where id = (u->>'user_id')::uuid;

    insert into rating_history (
      user_id, session_id, rating, delta,
      rating_before, rd_before, vol_before, games_before, games_after
    ) values (
      (u->>'user_id')::uuid, p_session_id, (u->>'rating')::numeric, (u->>'delta')::numeric,
      v_before.rating, v_before.rating_deviation, v_before.rating_volatility,
      v_before.rating_games, (u->>'games')::int
    );
  end loop;

  update sessions set ratings_applied = true where id = p_session_id;
end;
$$;

create or replace function apply_session_results(p_session_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_club    uuid;
  v_date    timestamptz;
  v_applied boolean;
  r jsonb;
begin
  select status, club_id, coalesce(ended_at, now()), coalesce(results_applied, false)
    into v_status, v_club, v_date, v_applied
    from sessions where id = p_session_id;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not (is_session_host(p_session_id) or is_app_admin()) then
    raise exception 'Only the host can record results for this session.' using errcode = 'P0001';
  end if;
  if v_status <> 'ended' then
    raise exception 'Results are recorded only once a session has ended.' using errcode = 'P0001';
  end if;
  if v_applied then return; end if;

  delete from session_results where session_id = p_session_id;
  if v_club is null then
    update sessions set results_applied = true where id = p_session_id;
    return;
  end if;

  for r in select value from jsonb_array_elements(p_rows) as value loop
    insert into session_results (
      session_id, club_id, user_id, session_date, rank, field_size, player_count,
      placement_points, podium_bonus, wins, losses, draws, scored_points, perf_adj
    ) values (
      p_session_id, v_club, (r->>'user_id')::uuid, v_date,
      (r->>'rank')::int, (r->>'field_size')::int, (r->>'player_count')::int,
      (r->>'placement_points')::int, coalesce((r->>'podium_bonus')::int, 0),
      coalesce((r->>'wins')::int, 0), coalesce((r->>'losses')::int, 0),
      coalesce((r->>'draws')::int, 0), coalesce((r->>'scored_points')::numeric, 0),
      coalesce((r->>'perf_adj')::numeric, 0.5)
    )
    on conflict (session_id, user_id) do update set
      club_id = excluded.club_id, session_date = excluded.session_date, rank = excluded.rank,
      field_size = excluded.field_size, player_count = excluded.player_count,
      placement_points = excluded.placement_points, podium_bonus = excluded.podium_bonus,
      wins = excluded.wins, losses = excluded.losses, draws = excluded.draws,
      scored_points = excluded.scored_points, perf_adj = excluded.perf_adj;
  end loop;

  update sessions set results_applied = true where id = p_session_id;
end;
$$;

-- ======================================================================
--  READ SIDE
-- ======================================================================

-- --- Overview: the numbers on the front page --------------------------
create or replace function admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select jsonb_build_object(
    'generated_at',      now(),
    'users',             (select count(*) from profiles where deleted_at is null),
    'users_deleted',     (select count(*) from profiles where deleted_at is not null),
    'users_new_7d',      (select count(*) from profiles where created_at > now() - interval '7 days'),
    'users_active_30d',  (select count(distinct pl.linked_user_id)
                            from players pl join sessions s on s.id = pl.session_id
                           where pl.linked_user_id is not null and s.created_at > now() - interval '30 days'),
    'sessions_total',    (select count(*) from sessions),
    'sessions_live',     (select count(*) from sessions where status = 'live'),
    'sessions_draft',    (select count(*) from sessions where status = 'draft'),
    'sessions_ended',    (select count(*) from sessions where status = 'ended'),
    'sessions_7d',       (select count(*) from sessions where created_at > now() - interval '7 days'),
    'matches_final',     (select count(*) from matches where status = 'final'),
    'clubs',             (select count(*) from clubs),
    'errors_24h',        (select count(*) from client_errors where created_at > now() - interval '24 hours'),
    'errors_open',       (select count(*) from client_errors where resolved_at is null),
    'admins',            (select count(*) from profiles where is_admin),
    'formats',           (select coalesce(jsonb_agg(f order by f.n desc), '[]'::jsonb)
                            from (select format, count(*) as n from sessions group by format) f),
    'daily',             (select coalesce(jsonb_agg(d order by d.day), '[]'::jsonb)
                            from (select date_trunc('day', created_at)::date as day,
                                         count(*) as sessions
                                    from sessions
                                   where created_at > now() - interval '21 days'
                                   group by 1) d)
  ) into v;
  return v;
end;
$$;

-- --- Health: the silent failures, by name ------------------------------
-- Each entry is { key, label, why, count, sample }. `sample` is at most five
-- offenders so a check can be acted on without a second query.
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
    select p.id, p.display_name, p.rating, p.rating_games
      from profiles p
     where p.deleted_at is null
       and p.rating_games > 0
       and not exists (select 1 from rating_history rh where rh.user_id = p.id)
  ),
  orphan_history as (
    select rh.id, rh.user_id, rh.rating, rh.created_at
      from rating_history rh
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
      'key', 'rating_without_history', 'label', 'Ratings with no sessions behind them',
      'why', 'profiles.rating is a snapshot. When every rated session is deleted the snapshot can survive — a number that corresponds to no game that exists. Reset rebuilds it.',
      'count', (select count(*) from ghost_rating),
      'sample', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select * from ghost_rating order by rating_games desc limit 5) x)),
    jsonb_build_object(
      'key', 'orphan_rating_history', 'label', 'Rating history pointing at a deleted session',
      'why', 'The FK nulls session_id instead of removing the row, leaving a bump on the trend line that traces back to nothing.',
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

-- --- People -----------------------------------------------------------
create or replace function admin_users(p_query text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_active desc), '[]'::jsonb) into v
  from (
    select
      p.id,
      p.display_name,
      u.email,
      p.rating,
      p.rating_games,
      p.is_admin,
      p.created_at,
      p.deleted_at,
      (select count(*) from sessions s where s.created_by = p.id)                     as sessions_hosted,
      (select count(distinct pl.session_id) from players pl where pl.linked_user_id = p.id) as sessions_played,
      (select count(*) from rating_history rh where rh.user_id = p.id)                as rated_sessions,
      (select count(*) from club_members cm where cm.user_id = p.id)                  as clubs,
      (select count(*) from client_errors ce
        where ce.user_id = p.id and ce.created_at > now() - interval '7 days')        as errors_7d,
      greatest(
        p.updated_at,
        coalesce((select max(s.created_at) from sessions s where s.created_by = p.id), 'epoch'::timestamptz),
        coalesce((select max(pl.joined_at) from players pl where pl.linked_user_id = p.id), 'epoch'::timestamptz)
      ) as last_active
    from profiles p
    left join auth.users u on u.id = p.id
    where p_query is null
       or p.display_name ilike '%' || p_query || '%'
       or u.email ilike '%' || p_query || '%'
    order by last_active desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    offset greatest(0, coalesce(p_offset, 0))
  ) x;
  return v;
end;
$$;

-- Everything about one account, including the numbers that tell apart the
-- two ways a "rating with no sessions" happens.
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
    -- The discriminator. linked_player_rows > 0 with confirmed_join_requests = 0
    -- means their sessions exist but the Player tab can't see them; history_rows = 0
    -- with rating_games > 0 means the rating outlived its sessions.
    'diagnosis', (
      select jsonb_build_object(
        'linked_player_rows',      (select count(*) from players pl where pl.linked_user_id = p_user_id),
        'confirmed_join_requests', (select count(*) from join_requests jr
                                      join auth.users u2 on u2.id = p_user_id
                                     where jr.status = 'confirmed' and lower(jr.email) = lower(u2.email)),
        'history_rows',            (select count(*) from rating_history rh where rh.user_id = p_user_id),
        'history_orphaned',        (select count(*) from rating_history rh where rh.user_id = p_user_id and rh.session_id is null),
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

-- --- Sessions ---------------------------------------------------------
create or replace function admin_sessions(p_status text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v
  from (
    select s.id, s.name, s.format, s.scoring_format, s.status, s.created_at, s.started_at, s.ended_at,
           s.public_token, s.counts_for_league,
           coalesce(s.ratings_applied, false) as ratings_applied,
           coalesce(s.results_applied, false) as results_applied,
           s.created_by, ph.display_name as host_name,
           cl.name as club_name,
           (select count(*) from players pl where pl.session_id = s.id)                                   as players,
           (select count(*) from players pl where pl.session_id = s.id and pl.linked_user_id is not null) as accounts,
           (select count(*) from rounds r where r.session_id = s.id)                                      as rounds,
           (select count(*) from matches m join rounds r on r.id = m.round_id
             where r.session_id = s.id and m.status = 'final')                                            as final_matches
      from sessions s
      left join profiles ph on ph.id = s.created_by
      left join clubs cl on cl.id = s.club_id
     where p_status is null or s.status = p_status
     order by s.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x;
  return v;
end;
$$;

-- --- Activity feed ----------------------------------------------------
-- Everything that happened, newest first, from the tables that already
-- record it. No new writes anywhere — this is assembled from what exists.
create or replace function admin_activity(p_limit integer default 80)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb) into v
  from (
    select 'session_created' as kind, s.created_at as at, s.id as ref,
           jsonb_build_object('name', s.name, 'format', s.format, 'who', ph.display_name) as detail
      from sessions s left join profiles ph on ph.id = s.created_by
    union all
    select 'session_ended', s.ended_at, s.id,
           jsonb_build_object('name', s.name, 'who', ph.display_name,
                              'rated', coalesce(s.ratings_applied, false))
      from sessions s left join profiles ph on ph.id = s.created_by
     where s.ended_at is not null
    union all
    select 'account_created', p.created_at, p.id,
           jsonb_build_object('who', p.display_name)
      from profiles p
    union all
    select 'club_created', c.created_at, c.id,
           jsonb_build_object('name', c.name, 'who', ph.display_name)
      from clubs c left join profiles ph on ph.id = c.created_by
    union all
    select 'club_joined', cm.joined_at, cm.club_id,
           jsonb_build_object('name', c.name, 'who', p.display_name, 'role', cm.role)
      from club_members cm
      join clubs c on c.id = cm.club_id
      left join profiles p on p.id = cm.user_id
    union all
    select 'score_edited', se.edited_at, se.match_id,
           jsonb_build_object('who', p.display_name,
                              'from', concat_ws('-', se.old_score_a, se.old_score_b),
                              'to',   concat_ws('-', se.new_score_a, se.new_score_b),
                              'reason', se.reason)
      from score_edits se left join profiles p on p.id = se.edited_by
    union all
    select 'claim', pc.created_at, pc.session_id,
           jsonb_build_object('who', p.display_name, 'status', pc.status)
      from player_claims pc left join profiles p on p.id = pc.claimant_user_id
    union all
    select 'error', ce.created_at, null::uuid,
           jsonb_build_object('message', ce.message, 'route', ce.route, 'kind', ce.kind)
      from client_errors ce
    union all
    select 'admin_action', aa.created_at, aa.target_id,
           jsonb_build_object('action', aa.action, 'who', p.display_name, 'detail', aa.detail)
      from admin_actions aa left join profiles p on p.id = aa.admin_id
    order by at desc
    limit greatest(1, least(coalesce(p_limit, 80), 300))
  ) x;
  return v;
end;
$$;

-- --- Errors, grouped --------------------------------------------------
create or replace function admin_errors(p_hours integer default 168, p_include_resolved boolean default false, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen desc), '[]'::jsonb) into v
  from (
    select ce.fingerprint,
           min(ce.created_at)                                   as first_seen,
           max(ce.created_at)                                   as last_seen,
           count(*)                                             as occurrences,
           count(distinct ce.user_id)                           as users,
           bool_or(ce.resolved_at is null)                      as open,
           (array_agg(ce.message order by ce.created_at desc))[1] as message,
           (array_agg(ce.kind    order by ce.created_at desc))[1] as kind,
           (array_agg(ce.route   order by ce.created_at desc))[1] as route,
           (array_agg(ce.stack   order by ce.created_at desc))[1] as stack,
           (array_agg(ce.app_version order by ce.created_at desc))[1] as app_version
      from client_errors ce
     where ce.created_at > now() - make_interval(hours => greatest(1, coalesce(p_hours, 168)))
       and (coalesce(p_include_resolved, false) or ce.resolved_at is null)
     group by ce.fingerprint
     order by max(ce.created_at) desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x;
  return v;
end;
$$;

-- ======================================================================
--  REPAIR SIDE — small, reversible, and logged
-- ======================================================================

-- Put a rating back where it belongs.
--   no remaining history  -> reset to a new player (1500 / 350 / 0.06 / 0 games)
--   history remains       -> restore the most recent snapshot in that history
-- Never invents a number: both branches use values the database already holds.
create or replace function admin_reset_user_rating(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_before profiles%rowtype;
  v_last   rating_history%rowtype;
  v_mode   text;
  v_after  profiles%rowtype;
begin
  perform admin_guard();
  select * into v_before from profiles where id = p_user_id;
  if not found then raise exception 'No such account.' using errcode = 'P0002'; end if;

  select * into v_last from rating_history
   where user_id = p_user_id order by created_at desc, id desc limit 1;

  if not found then
    v_mode := 'defaults';
    update profiles set
      rating = 1500, rating_deviation = 350, rating_volatility = 0.06,
      rating_games = 0, updated_at = now()
    where id = p_user_id;
  else
    v_mode := 'from_history';
    update profiles set
      rating       = v_last.rating,
      rating_games = coalesce(v_last.games_after, rating_games),
      updated_at   = now()
    where id = p_user_id;
  end if;

  select * into v_after from profiles where id = p_user_id;

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), 'reset_rating', 'user', p_user_id, jsonb_build_object(
    'mode', v_mode,
    'before', jsonb_build_object('rating', v_before.rating, 'rd', v_before.rating_deviation,
                                 'vol', v_before.rating_volatility, 'games', v_before.rating_games),
    'after',  jsonb_build_object('rating', v_after.rating, 'rd', v_after.rating_deviation,
                                 'vol', v_after.rating_volatility, 'games', v_after.rating_games)));

  return jsonb_build_object('mode', v_mode, 'rating', v_after.rating, 'games', v_after.rating_games);
end;
$$;

-- Point a session's player row at the right account (or at none).
-- This is the repair for "I claimed the wrong name" and for a player whose
-- claim never landed.
create or replace function admin_link_player(p_player_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_player  players%rowtype;
  v_session uuid;
begin
  perform admin_guard();
  select * into v_player from players where id = p_player_id;
  if not found then raise exception 'No such player.' using errcode = 'P0002'; end if;
  v_session := v_player.session_id;

  if p_user_id is not null then
    if not exists (select 1 from profiles where id = p_user_id) then
      raise exception 'No such account.' using errcode = 'P0002';
    end if;
    -- One account can hold at most one seat in a session; two seats would
    -- rate the same person twice for the same match.
    if exists (
      select 1 from players pl
       where pl.session_id = v_session and pl.linked_user_id = p_user_id and pl.id <> p_player_id
    ) then
      raise exception 'That account already holds a spot in this session.' using errcode = 'P0001';
    end if;
  end if;

  update players set linked_user_id = p_user_id where id = p_player_id;

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), case when p_user_id is null then 'unlink_player' else 'link_player' end,
          'player', p_player_id,
          jsonb_build_object('session_id', v_session, 'player', v_player.display_name,
                             'from', v_player.linked_user_id, 'to', p_user_id));

  return jsonb_build_object('player_id', p_player_id, 'linked_user_id', p_user_id);
end;
$$;

-- Grant or revoke admin. Refuses to remove the last one, because an app with
-- no admins can only be fixed with a SQL console.
create or replace function admin_set_admin(p_user_id uuid, p_is_admin boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_remaining integer;
begin
  perform admin_guard();
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;
  if p_is_admin is false then
    select count(*) into v_remaining from profiles where is_admin and id <> p_user_id;
    if v_remaining = 0 then
      raise exception 'That is the last admin — promote someone else first.' using errcode = 'P0001';
    end if;
  end if;

  update profiles set is_admin = coalesce(p_is_admin, false), updated_at = now() where id = p_user_id;

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), 'set_admin', 'user', p_user_id, jsonb_build_object('is_admin', coalesce(p_is_admin, false)));

  return jsonb_build_object('user_id', p_user_id, 'is_admin', coalesce(p_is_admin, false));
end;
$$;

-- Mark an error group handled. Doesn't delete anything: the rows stay for
-- history, they just stop appearing in the open list.
create or replace function admin_resolve_error(p_fingerprint text, p_resolved boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  perform admin_guard();
  update client_errors
     set resolved_at = case when coalesce(p_resolved, true) then now() else null end
   where fingerprint = p_fingerprint;
  get diagnostics v_count = row_count;

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), 'resolve_error', 'error', null,
          jsonb_build_object('fingerprint', p_fingerprint, 'rows', v_count, 'resolved', coalesce(p_resolved, true)));
  return v_count;
end;
$$;

-- --- Grants -----------------------------------------------------------
-- Every one of these self-guards, so exposure to `authenticated` is safe: a
-- non-admin calling any of them gets "Admins only." rather than data.
do $$
declare f text;
begin
  foreach f in array array[
    'admin_overview()',
    'admin_health()',
    'admin_users(text, integer, integer)',
    'admin_user_detail(uuid)',
    'admin_sessions(text, integer)',
    'admin_activity(integer)',
    'admin_errors(integer, boolean, integer)',
    'admin_reset_user_rating(uuid)',
    'admin_link_player(uuid, uuid)',
    'admin_set_admin(uuid, boolean)',
    'admin_resolve_error(text, boolean)'
  ]
  loop
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

comment on function admin_health() is
  'The silent-failure checks: unrated ended sessions, club sessions missing from the league, ratings with no history behind them, orphaned history rows, account-linked players with no join request (invisible in the Player tab), stuck live sessions and stale drafts.';
