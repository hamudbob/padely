-- ---------------------------------------------------------------------
-- 0043_admin_console_2.sql
--
-- The admin console could inspect a PERSON but not a SESSION — and a session
-- is what this app is made of. Every support message is "this session is
-- stuck / wrong / missing", and answering one meant reading a Playwright
-- trace by hand. This migration adds the three things that turn the console
-- from a set of counters into something you can actually work from:
--
--   1. admin_session_detail  — one session, all the way down: players and
--      the accounts they're linked to, rounds, matches, every score edit,
--      the rating rows it wrote, its league rows, and the join requests and
--      claims that explain who is who.
--   2. admin_live_now        — what is running this minute, and how stale it
--      is. When someone messages mid-session you see what they see.
--   3. admin_search          — one box that takes a join code, a public
--      token, a uuid, an email or a name, and resolves it.
--
-- Plus admin_growth (do people come back, not just how many exist) and an
-- app_settings row the app reads on load, so a message can be put on every
-- screen — or signups paused — without a deploy.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

-- ======================================================================
--  1. One session, all the way down
-- ======================================================================
create or replace function admin_session_detail(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select jsonb_build_object(
    'session', (
      select to_jsonb(x) from (
        select s.id, s.name, s.format, s.scoring_format, s.ranking_basis, s.status,
               s.join_code, s.public_token, s.fixed_partner_style, s.team_score_mode,
               s.counts_for_league, coalesce(s.ratings_applied, false) as ratings_applied,
               coalesce(s.results_applied, false) as results_applied,
               s.created_at, s.started_at, s.ended_at,
               s.created_by, ph.display_name as host_name, hu.email as host_email,
               s.club_id, cl.name as club_name
          from sessions s
          left join profiles ph on ph.id = s.created_by
          left join auth.users hu on hu.id = s.created_by
          left join clubs cl on cl.id = s.club_id
         where s.id = p_session_id
      ) x),

    -- Who is on court, and — the part that matters for support — whether
    -- each seat is attached to an account, and by which route. A player with
    -- a linked account but no confirmed join request is invisible in their
    -- own Player tab; that is visible here at a glance.
    'players', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.display_name), '[]'::jsonb)
        from (
          select pl.id, pl.display_name, pl.gender, pl.team_side, pl.preferred_side,
                 pl.status, pl.matches_played, pl.rests, pl.email,
                 pl.linked_user_id, pr.display_name as account_name, au.email as account_email,
                 exists (
                   select 1 from join_requests jr
                    where jr.session_id = p_session_id
                      and jr.status = 'confirmed'
                      and au.email is not null
                      and lower(jr.email) = lower(au.email)
                 ) as has_join_request
            from players pl
            left join profiles pr on pr.id = pl.linked_user_id
            left join auth.users au on au.id = pl.linked_user_id
           where pl.session_id = p_session_id
        ) p),

    'rounds', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.sequence), '[]'::jsonb)
        from (
          select rd.id, rd.sequence, rd.status, rd.generation_reason, rd.generated_at,
                 (select coalesce(jsonb_agg(to_jsonb(m) order by m.court_ordinal), '[]'::jsonb)
                    from (
                      select mt.id, c.display_name as court_label, c.ordinal as court_ordinal,
                             mt.score_a, mt.score_b,
                             mt.outcome, mt.status,
                             (select string_agg(pl2.display_name, ' & ' order by pl2.display_name)
                                from match_participants mp2
                                join players pl2 on pl2.id = mp2.player_id
                               where mp2.match_id = mt.id and mp2.side = 'A') as team_a,
                             (select string_agg(pl3.display_name, ' & ' order by pl3.display_name)
                                from match_participants mp3
                                join players pl3 on pl3.id = mp3.player_id
                               where mp3.match_id = mt.id and mp3.side = 'B') as team_b
                        from matches mt
                        left join courts c on c.id = mt.court_id
                       where mt.round_id = rd.id
                    ) m) as matches
            from rounds rd
           where rd.session_id = p_session_id
        ) r),

    'score_edits', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.edited_at desc), '[]'::jsonb)
        from (
          select se.id, se.old_score_a, se.old_score_b, se.new_score_a, se.new_score_b,
                 se.reason, se.edited_at, pr.display_name as edited_by
            from score_edits se
            join matches mt on mt.id = se.match_id
            join rounds rd on rd.id = mt.round_id
            left join profiles pr on pr.id = se.edited_by
           where rd.session_id = p_session_id
           order by se.edited_at desc limit 50
        ) e),

    -- What the session actually wrote when it ended. Empty here with an
    -- ended status is the silent-failure signature.
    'ratings', (
      select coalesce(jsonb_agg(to_jsonb(h) order by h.delta desc), '[]'::jsonb)
        from (
          select rh.user_id, pr.display_name, rh.rating, rh.delta,
                 rh.rating_before, rh.games_before, rh.games_after, rh.created_at
            from rating_history rh
            left join profiles pr on pr.id = rh.user_id
           where rh.session_id = p_session_id
        ) h),
    'league_rows', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.rank), '[]'::jsonb)
        from (
          select sr.user_id, pr.display_name, sr.rank, sr.placement_points, sr.podium_bonus,
                 sr.wins, sr.losses, sr.draws, sr.perf_adj
            from session_results sr
            left join profiles pr on pr.id = sr.user_id
           where sr.session_id = p_session_id
        ) l),

    'join_requests', (
      select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at), '[]'::jsonb)
        from (
          select jr.id, jr.display_name, jr.email, jr.status, jr.player_id, jr.created_at, jr.decided_at
            from join_requests jr where jr.session_id = p_session_id
        ) j),
    'claims', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
        from (
          select pc.id, pc.player_id, pc.claimant_user_id, pr.display_name as claimant,
                 pc.status, pc.created_at, pc.decided_at
            from player_claims pc
            left join profiles pr on pr.id = pc.claimant_user_id
           where pc.session_id = p_session_id
        ) c)
  ) into v;
  return v;
end;
$$;

-- ======================================================================
--  2. What is happening right now
-- ======================================================================
-- "Stale" is the number worth reading: a live session whose last score
-- landed forty minutes ago is either finished-and-abandoned or stuck, and
-- both are worth knowing before the host messages you.
create or replace function admin_live_now()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_activity desc nulls last), '[]'::jsonb) into v
  from (
    select s.id, s.name, s.format, s.status, s.join_code, s.public_token,
           s.started_at, ph.display_name as host_name, cl.name as club_name,
           (select count(*) from players pl where pl.session_id = s.id) as players,
           (select max(rd.sequence) from rounds rd where rd.session_id = s.id) as current_round,
           (select count(*) from rounds rd where rd.session_id = s.id) as rounds,
           (select count(*) from matches mt join rounds rd on rd.id = mt.round_id
             where rd.session_id = s.id and mt.status = 'final') as scored,
           (select count(*) from matches mt join rounds rd on rd.id = mt.round_id
             where rd.session_id = s.id and mt.status <> 'final') as unscored,
           greatest(
             coalesce((select max(mt.updated_at) from matches mt join rounds rd on rd.id = mt.round_id
                        where rd.session_id = s.id), 'epoch'::timestamptz),
             coalesce((select max(rd.generated_at) from rounds rd where rd.session_id = s.id), 'epoch'::timestamptz),
             coalesce(s.started_at, s.created_at)
           ) as last_activity
      from sessions s
      left join profiles ph on ph.id = s.created_by
      left join clubs cl on cl.id = s.club_id
     where s.status = 'live'
  ) x;
  return v;
end;
$$;

-- ======================================================================
--  3. One box, anything in it
-- ======================================================================
-- Join code, public token, uuid, email, display name, club name or club
-- code. Returns a flat list of hits so the UI doesn't need to know which
-- kind of thing was typed — which is the point, because neither does the
-- person typing it during a support conversation.
create or replace function admin_search(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  q text := btrim(coalesce(p_query, ''));
  v_uuid uuid;
begin
  perform admin_guard();
  if length(q) < 2 then return '[]'::jsonb; end if;

  -- A uuid is unambiguous; try to read one out of the query first.
  begin
    v_uuid := q::uuid;
  exception when others then
    v_uuid := null;
  end;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.weight, x.label), '[]'::jsonb) into v
  from (
    -- Sessions: id, join code, public token, name
    select 1 as weight, 'session' as type, s.id::text as id, s.name as label,
           concat_ws(' · ', s.status, s.format, 'code ' || s.join_code, ph.display_name) as sublabel
      from sessions s
      left join profiles ph on ph.id = s.created_by
     where (v_uuid is not null and s.id = v_uuid)
        or upper(s.join_code) = upper(q)
        or s.public_token = q
        or s.name ilike '%' || q || '%'
    union all
    -- People: id, email, display name
    select 2, 'user', p.id::text, p.display_name,
           concat_ws(' · ', u.email, 'rating ' || round(p.rating)::text,
                     p.rating_games::text || ' games')
      from profiles p
      left join auth.users u on u.id = p.id
     where (v_uuid is not null and p.id = v_uuid)
        or p.display_name ilike '%' || q || '%'
        or u.email ilike '%' || q || '%'
    union all
    -- Clubs: id, name, club code
    select 3, 'club', c.id::text, c.name,
           concat_ws(' · ', 'code ' || c.club_code,
                     (select count(*) from club_members cm where cm.club_id = c.id)::text || ' members')
      from clubs c
     where (v_uuid is not null and c.id = v_uuid)
        or c.name ilike '%' || q || '%'
        or upper(c.club_code) = upper(q)
    union all
    -- A player row inside a session, found by the name written on it. This
    -- is how "the guest called Budi" gets located.
    select 4, 'player', pl.session_id::text, pl.display_name,
           concat_ws(' · ', 'in ' || s.name, case when pl.linked_user_id is null then 'guest' else 'linked' end)
      from players pl
      join sessions s on s.id = pl.session_id
     where pl.display_name ilike '%' || q || '%'
     limit 20
  ) x;
  return v;
end;
$$;

-- ======================================================================
--  4. Growth: do people come back
-- ======================================================================
create or replace function admin_growth()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  select jsonb_build_object(
    'weekly', (
      select coalesce(jsonb_agg(to_jsonb(w) order by w.week), '[]'::jsonb)
        from (
          select date_trunc('week', d)::date as week,
                 (select count(*) from profiles p
                   where p.created_at >= d and p.created_at < d + interval '7 days') as signups,
                 (select count(*) from sessions s
                   where s.created_at >= d and s.created_at < d + interval '7 days') as sessions,
                 (select count(distinct s.created_by) from sessions s
                   where s.created_at >= d and s.created_at < d + interval '7 days') as active_hosts,
                 (select count(distinct pl.linked_user_id)
                    from players pl join sessions s on s.id = pl.session_id
                   where pl.linked_user_id is not null
                     and s.created_at >= d and s.created_at < d + interval '7 days') as active_players
            from generate_series(date_trunc('week', now()) - interval '11 weeks',
                                 date_trunc('week', now()), interval '1 week') d
        ) w),
    -- The funnel, over accounts old enough to have had a fair chance.
    'funnel', (
      select jsonb_build_object(
        'accounts',        count(*),
        'onboarded',       count(*) filter (where p.onboarded_at is not null),
        'played_ever',     count(*) filter (where exists (
                              select 1 from players pl where pl.linked_user_id = p.id)),
        'played_in_7d',    count(*) filter (where exists (
                              select 1 from players pl join sessions s on s.id = pl.session_id
                               where pl.linked_user_id = p.id
                                 and s.created_at < p.created_at + interval '7 days')),
        'played_twice',    count(*) filter (where (
                              select count(distinct pl.session_id) from players pl
                               where pl.linked_user_id = p.id) >= 2),
        'hosted_ever',     count(*) filter (where exists (
                              select 1 from sessions s where s.created_by = p.id)))
        from profiles p
       where p.deleted_at is null
         and p.created_at < now() - interval '7 days'),
    -- Accounts that signed up and then did nothing. The list worth acting on.
    'stalled', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb)
        from (
          select p.id, p.display_name, u.email, p.created_at,
                 (p.onboarded_at is not null) as onboarded
            from profiles p
            left join auth.users u on u.id = p.id
           where p.deleted_at is null
             and p.created_at < now() - interval '7 days'
             and not exists (select 1 from players pl where pl.linked_user_id = p.id)
             and not exists (select 1 from sessions s where s.created_by = p.id)
           order by p.created_at desc limit 20
        ) s)
  ) into v;
  return v;
end;
$$;

-- ======================================================================
--  5. A switch the app reads, so a problem doesn't need a deploy
-- ======================================================================
create table if not exists app_settings (
  id                  boolean primary key default true,
  banner_message      text,
  banner_tone         text not null default 'info',
  banner_until        timestamptz,
  signups_paused      boolean not null default false,
  maintenance_message text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  constraint app_settings_singleton check (id),
  constraint app_settings_tone check (banner_tone in ('info', 'warn'))
);
insert into app_settings (id) values (true) on conflict (id) do nothing;

alter table app_settings enable row level security;
-- Deliberately readable by everyone, including signed-out visitors: the
-- banner has to reach the person who can't sign in. Writes are admin-only
-- and go through the function below.
drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings for select using (true);

create or replace function get_app_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'banner_message', case
        when s.banner_until is not null and s.banner_until < now() then null
        else s.banner_message end,
    'banner_tone', s.banner_tone,
    'banner_until', s.banner_until,
    'signups_paused', s.signups_paused,
    'maintenance_message', s.maintenance_message
  ) from app_settings s where s.id;
$$;
grant execute on function get_app_settings() to anon, authenticated;

create or replace function admin_set_app_settings(
  p_banner_message      text default null,
  p_banner_tone         text default 'info',
  p_banner_until        timestamptz default null,
  p_signups_paused      boolean default false,
  p_maintenance_message text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform admin_guard();
  update app_settings set
    banner_message      = nullif(btrim(coalesce(p_banner_message, '')), ''),
    banner_tone         = case when p_banner_tone in ('info', 'warn') then p_banner_tone else 'info' end,
    banner_until        = p_banner_until,
    signups_paused      = coalesce(p_signups_paused, false),
    maintenance_message = nullif(btrim(coalesce(p_maintenance_message, '')), ''),
    updated_at          = now(),
    updated_by          = auth.uid()
  where id;

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), 'app_settings', 'app', null, jsonb_build_object(
    'banner', p_banner_message, 'tone', p_banner_tone, 'until', p_banner_until,
    'signups_paused', p_signups_paused, 'maintenance', p_maintenance_message));

  select get_app_settings() into v;
  return v;
end;
$$;

-- ======================================================================
--  6. End a session that is stuck
-- ======================================================================
-- The most common support fix there is: a host closed the tab and the
-- session sits live forever, holding its join code. This only moves the
-- status — it does NOT apply ratings, because those are computed on the
-- client from the final matches. Press "Re-run finalize" afterwards if the
-- session should count.
create or replace function admin_force_end_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  perform admin_guard();
  select status into v_before from sessions where id = p_session_id;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_before = 'ended' then
    return jsonb_build_object('session_id', p_session_id, 'status', 'ended', 'changed', false);
  end if;

  update sessions set status = 'ended', ended_at = coalesce(ended_at, now()) where id = p_session_id;

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), 'force_end_session', 'session', p_session_id,
          jsonb_build_object('from', v_before, 'to', 'ended'));

  return jsonb_build_object('session_id', p_session_id, 'status', 'ended', 'changed', true);
end;
$$;

-- --- Grants -----------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'admin_session_detail(uuid)',
    'admin_live_now()',
    'admin_search(text)',
    'admin_growth()',
    'admin_set_app_settings(text, text, timestamptz, boolean, text)',
    'admin_force_end_session(uuid)'
  ]
  loop
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

comment on table app_settings is
  'One row the whole app reads on load: an announcement banner, a signup pause and a maintenance note. Readable by everyone (a banner has to reach someone who cannot sign in); writable only through admin_set_app_settings.';
