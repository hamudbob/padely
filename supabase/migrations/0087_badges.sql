-- 0087: Badges (Nov 2026).
--
-- 30 badges, agreed with Hamud on 19 Nov 2026: 18 for the player and 12 for
-- each club, all shown on the one profile shelf whoever opens it. The full
-- list, with every rule, is in src/lib/badges/catalog.ts and the project's
-- badge spec; this file is the part that decides who has earned what.
--
-- HOW IT WORKS. Every badge is a stream of "occurrences" worked out from what
-- is already stored: a night played, a match won, a new partner, a member
-- joining the club you founded. Then:
--   levels  → level L is earned at the L-th occurrence (Nights played 25 at
--             the 25th night);
--   repeat  → every occurrence is the next ×N (Clean sheet ×3);
--   once    → the first occurrence (tiers, moments, hidden badges).
-- Badges are written to player_badges with the date and the night that earned
-- them, and never taken away: a score corrected later doesn't strip a badge.
--
-- WHEN. refresh_badges(user) works it all out again for one person. It runs:
--   * for everyone in a session when its results or ratings are applied;
--   * for a club's owner when someone joins, and an inviter when an invite is
--     accepted;
--   * every night for everyone (seasons ending, full Call-ups);
--   * once, for everyone, at the end of this file (past nights count, without
--     notifications).
-- Each new badge after that sends a notification (one per refresh, naming
-- every badge in it), which the push trigger (0073) sends to the phone.

-- --- 1. Tables ----------------------------------------------------------

create table if not exists player_badges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  -- null: a player badge. Set: a badge for this club.
  club_id    uuid references clubs(id) on delete cascade,
  badge      text not null,
  -- levels: the threshold (25 for "25 nights"); repeat: the count (3 for ×3);
  -- once: 1.
  level      integer not null,
  earned_at  timestamptz not null,
  session_id uuid references sessions(id) on delete set null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists player_badges_key
  on player_badges (user_id, coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid), badge, level);
create index if not exists player_badges_session_idx on player_badges (session_id);

-- Where each badge stands now ("31 of 50"), rewritten by every refresh.
create table if not exists badge_progress (
  user_id    uuid not null references profiles(id) on delete cascade,
  club_id    uuid references clubs(id) on delete cascade,
  badge      text not null,
  value      numeric not null default 0,
  detail     jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists badge_progress_key
  on badge_progress (user_id, coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid), badge);

-- What refresh_badges looks people up by, so the nightly run stays quick.
create index if not exists matches_scored_by_idx on matches (scored_by) where scored_by is not null;
create index if not exists match_participants_match_idx on match_participants (match_id);
create index if not exists club_invites_inviter_idx on club_invites (inviter_id) where status = 'accepted';
create index if not exists club_events_created_by_idx on club_events (created_by);
create index if not exists club_members_user_idx on club_members (user_id);

-- Read only through get_badges (below).
alter table player_badges enable row level security;
alter table badge_progress enable row level security;
revoke all on player_badges from anon, authenticated;
revoke all on badge_progress from anon, authenticated;

-- --- 2. The rules --------------------------------------------------------

-- Kind and levels of every badge. Kept in step with src/lib/badges/catalog.ts.
create or replace function badge_rules()
returns table (badge text, scope text, kind text, levels integer[])
language sql immutable set search_path = public as $$
  values
    ('competitor',      'player', 'once',   null::integer[]),
    ('master',          'player', 'once',   null),
    ('elite',           'player', 'once',   null),
    ('nights_played',   'player', 'levels', array[1,10,25,50,100,250]),
    ('games_played',    'player', 'levels', array[100,500,1000]),
    ('match_wins',      'player', 'levels', array[50,200,500]),
    ('on_a_roll',       'player', 'levels', array[4,8,12]),
    ('unbeaten_night',  'player', 'repeat', null),
    ('clean_sheet',     'player', 'repeat', null),
    ('giant_slayer',    'player', 'once',   null),
    ('big_climb',       'player', 'once',   null),
    ('mixer',           'player', 'levels', array[10,25,50]),
    ('rivalry',         'player', 'once',   null),
    ('host',            'player', 'levels', array[1,10,50]),
    ('night_owl',       'player', 'once',   null),
    ('early_bird',      'player', 'once',   null),
    ('marathon',        'player', 'once',   null),
    ('double_header',   'player', 'once',   null),
    ('club_nights',     'club',   'levels', array[1,10,25,50,100]),
    ('season_regular',  'club',   'repeat', null),
    ('night_champion',  'club',   'levels', array[1,5,10,25]),
    ('podiums',         'club',   'levels', array[5,10,25,50]),
    ('hat_trick',       'club',   'repeat', null),
    ('season_champion', 'club',   'repeat', null),
    ('season_podium',   'club',   'repeat', null),
    ('back_to_back',    'club',   'repeat', null),
    ('founder',         'club',   'levels', array[10,25,50,100]),
    ('recruiter',       'club',   'levels', array[1,5,10]),
    ('full_house',      'club',   'levels', array[1,10,25]),
    ('scorer',          'club',   'levels', array[25,100,250]);
$$;

-- Names for notifications. The app has its own copy with the descriptions.
create or replace function badge_name(p_badge text)
returns text language sql immutable set search_path = public as $$
  select case p_badge
    when 'competitor' then 'Competitor' when 'master' then 'Master' when 'elite' then 'Elite'
    when 'nights_played' then 'Nights played' when 'games_played' then 'Games played'
    when 'match_wins' then 'Match wins' when 'on_a_roll' then 'On a roll'
    when 'unbeaten_night' then 'Unbeaten night' when 'clean_sheet' then 'Clean sheet'
    when 'giant_slayer' then 'Giant-slayer' when 'big_climb' then 'Big climb'
    when 'mixer' then 'Mixer' when 'rivalry' then 'Rivalry' when 'host' then 'Host'
    when 'night_owl' then 'Night owl' when 'early_bird' then 'Early bird'
    when 'marathon' then 'Marathon' when 'double_header' then 'Double header'
    when 'club_nights' then 'Club nights' when 'season_regular' then 'Season regular'
    when 'night_champion' then 'Night champion' when 'podiums' then 'Podiums'
    when 'hat_trick' then 'Hat-trick' when 'season_champion' then 'Season champion'
    when 'season_podium' then 'Season podium' when 'back_to_back' then 'Back-to-back'
    when 'founder' then 'Founder' when 'recruiter' then 'Recruiter'
    when 'full_house' then 'Full house' when 'scorer' then 'Scorer'
    else p_badge end;
$$;

-- --- 3. A club's seasons, as the app counts them -------------------------
--
-- A straight port of src/lib/league/seasons.ts (seasonsUpTo): the first rule
-- starts 1 Jan 2000, a later rule starts its own seasons, all in UTC, from
-- the season holding the club's first league night up to the one holding now.

create or replace function badge_club_seasons(p_club uuid, p_now timestamptz default now())
returns table (n integer, s_start timestamptz, s_end timestamptz)
language plpgsql stable set search_path = public as $$
declare
  v_starts timestamptz[];
  v_sizes  integer[];
  v_fallback text;
  v_first  timestamptz;
  v_from   timestamptz;
  v_cursor timestamptz;
  v_at     timestamptz;
  i integer; j integer; k integer; v_size integer;
  v_start timestamptz; v_end timestamptz;
  v_n integer := 0;
  mi_at integer; mi_rule integer;
begin
  select coalesce(league_period, 'monthly') into v_fallback from clubs where id = p_club;
  select array_agg(starts_at order by starts_at),
         array_agg(case length when '2_month' then 2 when '3_month' then 3 when '6_month' then 6 when 'yearly' then 12 else 1 end order by starts_at)
    into v_starts, v_sizes
    from club_season_rules where club_id = p_club;
  if v_starts is null or v_starts[1] > timestamptz '2000-01-01 00:00:00+00' then
    v_starts := array[timestamptz '2000-01-01 00:00:00+00'] || coalesce(v_starts, '{}');
    v_sizes := array[coalesce(v_sizes[1],
      case v_fallback when '2_month' then 2 when '3_month' then 3 when '6_month' then 6 when 'yearly' then 12 else 1 end)] || coalesce(v_sizes, '{}');
  end if;

  select min(session_date) into v_first from session_results where club_id = p_club;
  v_from := case when v_first is not null and v_first <= p_now then v_first else p_now end;

  v_cursor := null;
  v_at := v_from;
  loop
    -- bounds of the season holding v_at
    i := 1;
    for j in 1 .. array_length(v_starts, 1) loop
      if v_starts[j] <= v_at then i := j; end if;
    end loop;
    v_size := v_sizes[i];
    mi_at := extract(year from v_at at time zone 'UTC')::int * 12 + extract(month from v_at at time zone 'UTC')::int - 1;
    mi_rule := extract(year from v_starts[i] at time zone 'UTC')::int * 12 + extract(month from v_starts[i] at time zone 'UTC')::int - 1;
    k := floor((mi_at - mi_rule)::numeric / v_size)::int;
    v_start := ((date_trunc('month', v_starts[i] at time zone 'UTC') + make_interval(months => k * v_size)) at time zone 'UTC');
    v_end := ((date_trunc('month', v_start at time zone 'UTC') + make_interval(months => v_size)) at time zone 'UTC');
    if i < array_length(v_starts, 1) and v_starts[i + 1] < v_end then v_end := v_starts[i + 1]; end if;

    if v_cursor is null then
      v_cursor := v_start; -- first pass only finds where Season 1 starts
      v_at := v_cursor;
      continue;
    end if;
    exit when v_cursor > p_now or v_n >= 600;
    v_n := v_n + 1;
    n := v_n; s_start := v_start; s_end := v_end;
    return next;
    v_cursor := v_end;
    v_at := v_cursor;
  end loop;
end;
$$;

-- A finished season's table, as getClubLeagueHistory builds it: counting
-- nights only, everyone who played (titles stay when people leave), at
-- least the club's minimum nights, ranked by points per night, then 1st
-- places, then average finish, then nights, then name.
create or replace function badge_season_table(p_club uuid, p_start timestamptz, p_end timestamptz)
returns table (user_id uuid, pos integer)
language sql stable set search_path = public as $$
  with r as (
    select sr.user_id, sr.rank, sr.placement_points + sr.podium_bonus as pts
      from session_results sr
      join sessions s on s.id = sr.session_id
     where sr.club_id = p_club
       and sr.session_date >= p_start and sr.session_date < p_end
       and coalesce(s.counts_for_league, true)
  ), agg as (
    select r.user_id, count(*) as nights, sum(pts)::numeric as pts,
           count(*) filter (where rank = 1) as firsts, avg(rank)::numeric as avg_rank
      from r group by r.user_id
  )
  select a.user_id,
         (row_number() over (order by a.pts / a.nights desc, a.firsts desc, a.avg_rank asc, a.nights desc,
                                      coalesce(p.display_name, 'Player') asc))::int
    from agg a
    left join profiles p on p.id = a.user_id
   where a.nights >= greatest(1, coalesce((select league_min_sessions from clubs where id = p_club), 1));
$$;

-- --- 4. Working it out for one person -------------------------------------

create or replace function refresh_badges(p_user uuid, p_notify boolean default true)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_tz   constant text := 'Asia/Jakarta';
  v_settled constant numeric := 110; -- PROVISIONAL_RD in src/lib/rating/glicko2.ts
  v_new  integer := 0;
  v_names text;
  v_count integer;
  rc record;
  rs record;
  v_prev_champ boolean;
  v_prev_n integer;
begin
  if p_user is null or not exists (select 1 from profiles where id = p_user and deleted_at is null) then
    return 0;
  end if;

  create temp table if not exists _badge_occ (
    club_id uuid, badge text, ts timestamptz, session_id uuid, detail jsonb
  ) on commit drop;
  truncate _badge_occ;

  -- Every finished match this person played, once.
  create temp table if not exists _badge_m (
    match_id uuid, session_id uuid, club_id uuid, ts timestamptz, side text,
    won boolean, lost boolean, my_score integer, their_score integer
  ) on commit drop;
  truncate _badge_m;
  insert into _badge_m
  select distinct on (m.id)
         m.id, s.id, s.club_id, coalesce(m.scored_at, s.ended_at, s.started_at, m.updated_at), mp.side,
         case when m.outcome is not null then (m.outcome = 'win_a' and mp.side = 'A') or (m.outcome = 'win_b' and mp.side = 'B')
              else (mp.side = 'A' and m.score_a > m.score_b) or (mp.side = 'B' and m.score_b > m.score_a) end,
         case when m.outcome is not null then (m.outcome = 'win_b' and mp.side = 'A') or (m.outcome = 'win_a' and mp.side = 'B')
              else (mp.side = 'A' and m.score_a < m.score_b) or (mp.side = 'B' and m.score_b < m.score_a) end,
         case when mp.side = 'A' then m.score_a else m.score_b end,
         case when mp.side = 'A' then m.score_b else m.score_a end
    from players p
    join match_participants mp on mp.player_id = p.id
    join matches m on m.id = mp.match_id and m.status = 'final' and coalesce(m.outcome, '') <> 'cancelled'
    join rounds r on r.id = m.round_id
    join sessions s on s.id = r.session_id and s.status = 'ended'
   where p.linked_user_id = p_user
   order by m.id;

  -- Every night: a session that ended with at least one scored match.
  create temp table if not exists _badge_n (
    session_id uuid, club_id uuid, starts timestamptz, ends timestamptz, matches integer, wins integer
  ) on commit drop;
  truncate _badge_n;
  insert into _badge_n
  select m.session_id, max(m.club_id::text)::uuid, coalesce(s.started_at, min(m.ts)), max(m.ts),
         count(*), count(*) filter (where m.won)
    from _badge_m m join sessions s on s.id = m.session_id
   group by m.session_id, s.started_at;

  -- Player · milestones
  insert into _badge_occ select null, 'nights_played', starts, session_id, null from _badge_n;
  insert into _badge_occ select null, 'games_played', ts, session_id, null from _badge_m;
  insert into _badge_occ select null, 'match_wins', ts, session_id, null from _badge_m where won;

  -- On a roll: the best run of weeks in a row so far. One occurrence each
  -- time the best run grows, so the L-th occurrence is when it first hit L.
  insert into _badge_occ
  with w as (
    select date_trunc('week', starts at time zone v_tz) as wk, min(starts) as first_ts,
           (array_agg(session_id order by starts))[1] as sid
      from _badge_n group by 1
  ), g as (
    select wk, first_ts, sid,
           wk - make_interval(weeks => (row_number() over (order by wk))::int) as island
      from w
  ), run as (
    select wk, first_ts, sid, row_number() over (partition by island order by wk) as streak from g
  ), best as (
    select *, coalesce(max(streak) over (order by wk rows between unbounded preceding and 1 preceding), 0) as prior_best from run
  )
  select null, 'on_a_roll', first_ts, sid, null from best where streak > prior_best;

  -- Player · moments
  insert into _badge_occ select null, 'unbeaten_night', ends, session_id, null
    from _badge_n where matches >= 4 and wins = matches;
  insert into _badge_occ select null, 'clean_sheet', ts, session_id,
         jsonb_build_object('score', my_score::text || '–0')
    from _badge_m where won and their_score = 0 and coalesce(my_score, 0) > 0;

  -- Giant-slayer: the other pair's average rating at the start of that night
  -- was 150+ above this pair's. Every one of the four needs a rating.
  insert into _badge_occ
  select null, 'giant_slayer', m.ts, m.session_id, jsonb_build_object('gap', round(x.theirs - x.mine))
    from _badge_m m
    join lateral (
      select avg(rb.rating_before) filter (where mp2.side = m.side) as mine,
             avg(rb.rating_before) filter (where mp2.side <> m.side) as theirs,
             count(rb.rating_before) as rated
        from match_participants mp2
        join players p2 on p2.id = mp2.player_id
        left join lateral (
          select rh.rating_before from rating_history rh
           where rh.user_id = p2.linked_user_id and rh.session_id = m.session_id and rh.rating_before is not null
           order by rh.created_at limit 1
        ) rb on true
       where mp2.match_id = m.match_id
    ) x on true
   where m.won and x.rated = 4 and x.theirs - x.mine >= 150;

  -- Big climb, and the tiers: from the rating history. A rating counts once
  -- it is settled (not provisional): its deviation at or under 110 — the one
  -- before the next night, or today's for the latest.
  create temp table if not exists _badge_rh (
    session_id uuid, ts timestamptz, rating numeric, delta numeric, rd_before numeric, rd_after numeric
  ) on commit drop;
  truncate _badge_rh;
  insert into _badge_rh
  select session_id, created_at, rating, delta, rd_before,
         coalesce(lead(rd_before) over (order by created_at), (select rating_deviation from profiles where id = p_user))
    from rating_history where user_id = p_user;

  insert into _badge_occ select null, 'big_climb', ts, session_id, jsonb_build_object('delta', round(delta))
    from _badge_rh where delta >= 50 and coalesce(rd_before, 999) <= v_settled;
  insert into _badge_occ select null, 'competitor', ts, session_id, jsonb_build_object('rating', round(rating))
    from _badge_rh where rating >= 1575 and rd_after <= v_settled;
  insert into _badge_occ select null, 'master', ts, session_id, jsonb_build_object('rating', round(rating))
    from _badge_rh where rating >= 1700 and rd_after <= v_settled;
  insert into _badge_occ select null, 'elite', ts, session_id, jsonb_build_object('rating', round(rating))
    from _badge_rh where rating >= 1800 and rd_after <= v_settled;

  -- Player · people. Someone without an account is told apart by name.
  create temp table if not exists _badge_other (
    match_id uuid, session_id uuid, ts timestamptz, partner boolean, who text, name text
  ) on commit drop;
  truncate _badge_other;
  insert into _badge_other
  select m.match_id, m.session_id, m.ts, mp2.side = m.side,
         coalesce(p2.linked_user_id::text, 'g:' || lower(btrim(p2.display_name))),
         coalesce(pr.display_name, p2.display_name)
    from _badge_m m
    join match_participants mp2 on mp2.match_id = m.match_id
    join players p2 on p2.id = mp2.player_id
    left join profiles pr on pr.id = p2.linked_user_id
   where p2.linked_user_id is distinct from p_user;

  insert into _badge_occ
  select null, 'mixer', ts, session_id, jsonb_build_object('name', name)
    from (select distinct on (who) who, ts, session_id, name from _badge_other where partner order by who, ts) x;

  insert into _badge_occ
  select null, 'rivalry', ts, session_id, jsonb_build_object('name', name, 'games', 20)
    from (select who, ts, session_id, name, row_number() over (partition by who order by ts, match_id) as k
            from _badge_other where not partner) x
   where k = 20;

  insert into _badge_occ
  select null, 'host', coalesce(s.started_at, s.ended_at), s.id, null
    from sessions s
   where s.created_by = p_user and s.status = 'ended'
     and exists (select 1 from rounds r join matches m on m.round_id = r.id
                  where r.session_id = s.id and m.status = 'final');

  -- Player · hidden
  insert into _badge_occ select null, 'night_owl', ends, session_id, null
    from _badge_n where extract(hour from ends at time zone v_tz) < 5;
  insert into _badge_occ select null, 'early_bird', starts, session_id, null
    from _badge_n where extract(hour from starts at time zone v_tz) between 4 and 7;
  insert into _badge_occ select null, 'marathon', ends, session_id, jsonb_build_object('matches', matches)
    from _badge_n where matches >= 12;
  insert into _badge_occ
  select null, 'double_header', starts, session_id, null
    from (select session_id, starts,
                 row_number() over (partition by (starts at time zone v_tz)::date order by starts) as k
            from _badge_n) x
   where k = 2;

  -- Club · nights, titles, podiums, hat-tricks
  insert into _badge_occ select club_id, 'club_nights', session_date, session_id, null
    from session_results where user_id = p_user;
  insert into _badge_occ select club_id, 'night_champion', session_date, session_id, null
    from session_results where user_id = p_user and rank = 1;
  insert into _badge_occ select club_id, 'podiums', session_date, session_id, jsonb_build_object('rank', rank)
    from session_results where user_id = p_user and rank <= 3;
  insert into _badge_occ
  with o as (
    select club_id, session_id, session_date, rank,
           row_number() over (partition by club_id order by session_date, session_id)
             - row_number() over (partition by club_id, rank = 1 order by session_date, session_id) as island
      from session_results where user_id = p_user
  ), runs as (
    select club_id, session_id, session_date,
           row_number() over (partition by club_id, island order by session_date, session_id) as k
      from o where rank = 1
  )
  select club_id, 'hat_trick', session_date, session_id, null from runs where k % 3 = 0;

  -- Club · seasons, for every club this person has played a league night in.
  for rc in select distinct sr.club_id from session_results sr where sr.user_id = p_user loop
    v_prev_champ := false;
    v_prev_n := null;
    for rs in select * from badge_club_seasons(rc.club_id) x where x.s_end <= now() order by x.n loop
      select t.pos into v_count from badge_season_table(rc.club_id, rs.s_start, rs.s_end) t where t.user_id = p_user;
      if v_count is not null then
        insert into _badge_occ values (rc.club_id, 'season_regular', rs.s_end, null, jsonb_build_object('season', rs.n));
        if v_count <= 3 then
          insert into _badge_occ values (rc.club_id, 'season_podium', rs.s_end, null, jsonb_build_object('season', rs.n, 'pos', v_count));
        end if;
        if v_count = 1 then
          insert into _badge_occ values (rc.club_id, 'season_champion', rs.s_end, null, jsonb_build_object('season', rs.n));
          if v_prev_champ and v_prev_n = rs.n - 1 then
            insert into _badge_occ values (rc.club_id, 'back_to_back', rs.s_end, null, jsonb_build_object('season', rs.n));
          end if;
        end if;
      end if;
      v_prev_champ := coalesce(v_count = 1, false);
      v_prev_n := rs.n;
    end loop;
  end loop;

  -- Club · organising
  insert into _badge_occ
  select cm.club_id, 'founder', m2.joined_at, null, null
    from club_members cm
    join club_members m2 on m2.club_id = cm.club_id
   where cm.user_id = p_user and cm.role = 'owner';
  insert into _badge_occ
  select ci.club_id, 'recruiter', coalesce(ci.decided_at, ci.created_at), null, null
    from club_invites ci
   where ci.inviter_id = p_user and ci.status = 'accepted' and ci.invitee_id <> p_user;
  insert into _badge_occ
  select e.club_id, 'full_house', e.scheduled_at, e.session_id, jsonb_build_object('event_id', e.id)
    from club_events e
   where e.created_by = p_user and e.status = 'scheduled' and e.max_players is not null
     and e.scheduled_at <= now()
     and (select count(*) from club_event_rsvps r where r.event_id = e.id and r.response = 'in') >= e.max_players;
  insert into _badge_occ
  select s.club_id, 'scorer', coalesce(m.scored_at, s.ended_at), s.id, null
    from matches m
    join rounds r on r.id = m.round_id
    join sessions s on s.id = r.session_id
   where m.scored_by = p_user and m.status = 'final' and s.club_id is not null;

  -- A club that's gone has no badges to show.
  delete from _badge_occ o where o.club_id is not null and not exists (select 1 from clubs where id = o.club_id);

  -- --- Award ---
  create temp table if not exists _badge_new (club_id uuid, badge text, level integer) on commit drop;
  truncate _badge_new;

  with ranked as (
    select o.*, row_number() over (partition by o.club_id, o.badge order by o.ts, o.session_id) as k
      from _badge_occ o
  ), award as (
    select r.club_id, r.badge, l.lv as level, r.ts, r.session_id, r.detail
      from ranked r
      join badge_rules() b on b.badge = r.badge and b.kind = 'levels'
      join lateral unnest(b.levels) as l(lv) on l.lv = r.k
    union all
    select r.club_id, r.badge, r.k::integer, r.ts, r.session_id, r.detail
      from ranked r join badge_rules() b on b.badge = r.badge and b.kind = 'repeat'
    union all
    select r.club_id, r.badge, 1, r.ts, r.session_id, r.detail
      from ranked r join badge_rules() b on b.badge = r.badge and b.kind = 'once'
     where r.k = 1
  ), ins as (
    insert into player_badges (user_id, club_id, badge, level, earned_at, session_id, detail)
    select p_user, club_id, badge, level, ts, session_id, detail from award
    on conflict (user_id, coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid), badge, level) do nothing
    returning club_id, badge, level
  )
  insert into _badge_new select * from ins;
  get diagnostics v_new = row_count;

  -- Progress, rewritten.
  delete from badge_progress where user_id = p_user;
  insert into badge_progress (user_id, club_id, badge, value, detail)
  select p_user, club_id, badge, count(*), null from _badge_occ group by club_id, badge;
  -- The few that show a "best so far" instead of a count.
  insert into badge_progress (user_id, club_id, badge, value, detail)
  select p_user, null, 'rivalry_best', x.games, jsonb_build_object('name', x.name)
    from (select who, max(name) as name, count(*) as games from _badge_other where not partner
           group by who order by count(*) desc limit 1) x;
  insert into badge_progress (user_id, club_id, badge, value, detail)
  select p_user, null, 'big_climb_best', max(delta), null from _badge_rh
   where coalesce(rd_before, 999) <= v_settled having max(delta) is not null;
  insert into badge_progress (user_id, club_id, badge, value, detail)
  select p_user, null, 'peak_rating', max(rating), null from _badge_rh
   where rd_after <= v_settled having max(rating) is not null;
  insert into badge_progress (user_id, club_id, badge, value, detail)
  select p_user, club_id, 'best_rank', min(rank), null from session_results where user_id = p_user group by club_id;

  -- One notification per refresh, naming everything new in it.
  if p_notify and v_new > 0 then
    select string_agg(
             case when b.kind = 'levels' then badge_name(n.badge) || ' ' || n.level
                  when b.kind = 'repeat' and n.level > 1 then badge_name(n.badge) || ' ×' || n.level
                  else badge_name(n.badge) end
             || coalesce(' · ' || cl.name, ''), ', ' order by n.badge, n.level)
      into v_names
      from _badge_new n
      join badge_rules() b on b.badge = n.badge
      left join clubs cl on cl.id = n.club_id;
    insert into notifications (user_id, type, title, body, data)
    values (p_user, 'badge',
            case when v_new = 1 then 'New badge' else v_new || ' new badges' end,
            v_names,
            jsonb_build_object('path', '/u/' || p_user || '/badges'));
  end if;

  return v_new;
end;
$$;
revoke all on function refresh_badges(uuid, boolean) from public, anon, authenticated;

-- The signed-in player, after their own night (the results screen asks, so
-- new badges are there before the hourly or nightly runs).
create or replace function refresh_my_badges()
returns integer
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return 0; end if;
  return refresh_badges(auth.uid(), true);
end;
$$;
revoke all on function refresh_my_badges() from public, anon;
grant execute on function refresh_my_badges() to authenticated;

-- Everyone who might have earned something from one session.
create or replace function refresh_badges_for_session(p_session uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in
    select distinct x from (
      select p.linked_user_id as x from players p where p.session_id = p_session
      union select created_by from sessions where id = p_session
      union select m.scored_by from matches m join rounds r on r.id = m.round_id where r.session_id = p_session
    ) y where x is not null
  loop
    begin
      perform refresh_badges(u, true);
    exception when others then
      null; -- a badge must never fail the end of a night
    end;
  end loop;
end;
$$;
revoke all on function refresh_badges_for_session(uuid) from public, anon, authenticated;

create or replace function refresh_all_badges(p_notify boolean default true)
returns integer
language plpgsql security definer set search_path = public as $$
declare u uuid; v integer := 0;
begin
  for u in select id from profiles where deleted_at is null loop
    begin
      v := v + refresh_badges(u, p_notify);
    exception when others then
      null;
    end;
  end loop;
  return v;
end;
$$;
revoke all on function refresh_all_badges(boolean) from public, anon, authenticated;

-- --- 5. When ----------------------------------------------------------------

create or replace function trg_badges_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ended'
     and (old.status is distinct from new.status
          or (new.ratings_applied and not coalesce(old.ratings_applied, false))
          or (new.results_applied and not coalesce(old.results_applied, false))) then
    perform refresh_badges_for_session(new.id);
  end if;
  return null;
exception when others then
  return null;
end;
$$;
drop trigger if exists badges_session on sessions;
create trigger badges_session
  after update of status, ratings_applied, results_applied on sessions
  for each row execute function trg_badges_session();

-- Founder: the owner, when the club grows.
create or replace function trg_badges_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select user_id into v_owner from club_members where club_id = new.club_id and role = 'owner' limit 1;
  if v_owner is not null and v_owner <> new.user_id then
    perform refresh_badges(v_owner, true);
  end if;
  return null;
exception when others then
  return null;
end;
$$;
drop trigger if exists badges_member on club_members;
create trigger badges_member after insert on club_members
  for each row execute function trg_badges_member();

-- Recruiter: the inviter, when an invite is accepted.
create or replace function trg_badges_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' and new.inviter_id is not null then
    perform refresh_badges(new.inviter_id, true);
  end if;
  return null;
exception when others then
  return null;
end;
$$;
drop trigger if exists badges_invite on club_invites;
create trigger badges_invite after update of status on club_invites
  for each row execute function trg_badges_invite();

-- Every night at 00:20 Jakarta (seasons end at midnight UTC, Call-ups fill
-- up): everyone, where pg_cron is available.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available here (%). Badges still update when a night ends.', sqlerrm;
    return;
  end;
  if exists (select 1 from cron.job where jobname = 'refresh-badges') then
    perform cron.unschedule('refresh-badges');
  end if;
  perform cron.schedule('refresh-badges', '20 17 * * *', 'select public.refresh_all_badges(true)');
end;
$$;

-- --- 6. Reading ---------------------------------------------------------------

-- Anyone's badges, for the profile shelf (public, like the profile itself).
create or replace function get_badges(p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not exists (select 1 from profiles where id = p_user and deleted_at is null) then null else
  jsonb_build_object(
    'earned', coalesce((
      select jsonb_agg(jsonb_build_object(
               'club_id', b.club_id, 'badge', b.badge, 'level', b.level, 'earned_at', b.earned_at,
               'session_id', b.session_id, 'detail', b.detail)
             order by b.earned_at)
        from player_badges b where b.user_id = p_user), '[]'::jsonb),
    'progress', coalesce((
      select jsonb_agg(jsonb_build_object('club_id', g.club_id, 'badge', g.badge, 'value', g.value, 'detail', g.detail))
        from badge_progress g where g.user_id = p_user), '[]'::jsonb),
    -- Every club with a badge or progress, plus the clubs they belong to.
    'clubs', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'logo_url', c.logo_url,
                                         'owner', exists (select 1 from club_members m where m.club_id = c.id and m.user_id = p_user and m.role = 'owner'))
             order by c.name)
        from clubs c
       where c.id in (select club_id from player_badges where user_id = p_user and club_id is not null
                      union select club_id from badge_progress where user_id = p_user and club_id is not null
                      union select club_id from club_members where user_id = p_user)), '[]'::jsonb),
    -- Has anyone ever reached the top tier? Its name stays hidden until then.
    'elite_seen', exists (select 1 from player_badges where badge = 'elite')
  ) end;
$$;
revoke all on function get_badges(uuid) from public;
grant execute on function get_badges(uuid) to anon, authenticated;

-- --- 7. Past nights count -------------------------------------------------------
-- Everyone, once, without notifications (or every phone would buzz 20 times).
select refresh_all_badges(false);
