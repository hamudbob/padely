-- =====================================================================
--  Screenshot seed — padelier-v2 ONLY. Never production.
--
--  Populates a believable club so the App Store screenshots show a real
--  Tuesday night instead of "Player 1, Player 2". Everything here is
--  invented: fourteen fictional members, one club, five weeks of played
--  sessions, and a scheduled session with a waiting list.
--
--  WHY SEEDED RATHER THAN PLAYED BY HAND: a profile only looks like a
--  profile once it has a rating trend, a record, and people it has played
--  with repeatedly. That is five completed sessions per person, ninety
--  scored matches. Doing that through the interface is an evening; this
--  is a minute.
--
--  THE MATCHES ARE REAL, NOT DECORATION. Every past session gets six
--  rounds on three courts with actual scores, and the league table is
--  computed FROM those scores. That matters because a screenshot shows
--  two screens' worth of numbers at once — if the leaderboard were random
--  it would contradict the match results sitting behind it, and that is
--  exactly the kind of thing an App Store reviewer notices.
--
--  SAFE TO RE-RUN, WITH ONE CATCH. Everything is keyed on ids beginning
--  with 'dddd', and the script deletes those before inserting. But deleting
--  the fourteen accounts cascades, so ANY session you created by hand while
--  signed in as one of them goes with them, whatever its own id. Re-run this
--  before you set up a live session for screenshots, never after.
--
--  AFTER RUNNING: sign in as ana@demo.padelier.id / DemoPadel2026 to
--  photograph the profile screen. All fourteen share that password.
-- =====================================================================

-- --- Clean up a previous run --------------------------------------------
delete from club_event_rsvps where user_id::text like 'dddd%';
delete from club_events       where club_id::text like 'dddd%';
delete from rating_history    where user_id::text like 'dddd%';
delete from session_results   where user_id::text like 'dddd%';
delete from match_participants where player_id in (select id from players where session_id::text like 'dddd%');
delete from matches           where round_id in (select id from rounds where session_id::text like 'dddd%');
delete from rounds            where session_id::text like 'dddd%';
delete from courts            where session_id::text like 'dddd%';
delete from players           where session_id::text like 'dddd%';
delete from sessions          where id::text like 'dddd%';
delete from club_members      where club_id::text like 'dddd%';
delete from clubs             where id::text like 'dddd%';
delete from teams             where id::text like 'dddd%';
delete from profiles          where id::text like 'dddd%';
delete from auth.identities   where user_id::text like 'dddd%';
delete from auth.users        where id::text like 'dddd%';

-- --- Fourteen members ----------------------------------------------------
-- Eight men, six women: enough for three courts of Mix, and lopsided enough
-- that the fairness cap has something to do.
-- A plain table, not a temp one. Supabase's SQL editor commits after every
-- statement, and a temp table declared ON COMMIT DROP disappears before the
-- next statement can read it — which is exactly what happened the first time
-- this was run there. It is dropped again at the bottom of the file.
drop table if exists demo_people;
create table demo_people (n int, id uuid, name text, gender char, rating numeric, games int, bio text);
insert into demo_people values
  ( 1,'dddd0000-0000-0000-0000-000000000001','Ana Prameswari', 'F',1712, 38,'Left side. Will chase everything.'),
  ( 2,'dddd0000-0000-0000-0000-000000000002','Bagas Nugroho',  'M',1688, 41,'Tuesdays and Thursdays.'),
  ( 3,'dddd0000-0000-0000-0000-000000000003','Sari Wijaya',    'F',1655, 33,null),
  ( 4,'dddd0000-0000-0000-0000-000000000004','Rizky Pratama',  'M',1634, 45,'Ex-tennis. Still hitting flat.'),
  ( 5,'dddd0000-0000-0000-0000-000000000005','Nadia Kusuma',   'F',1601, 29,null),
  ( 6,'dddd0000-0000-0000-0000-000000000006','Fajar Ramadhan', 'M',1578, 36,'Right side, please.'),
  ( 7,'dddd0000-0000-0000-0000-000000000007','Putri Handayani','F',1552, 24,'Started in March.'),
  ( 8,'dddd0000-0000-0000-0000-000000000008','Andhika Surya',  'M',1530, 31,null),
  ( 9,'dddd0000-0000-0000-0000-000000000009','Maya Lestari',   'F',1508, 22,null),
  (10,'dddd0000-0000-0000-0000-00000000000a','Reza Mahendra',  'M',1487, 27,'Bandeja is a work in progress.'),
  (11,'dddd0000-0000-0000-0000-00000000000b','Dewi Anggraini', 'F',1463, 19,null),
  (12,'dddd0000-0000-0000-0000-00000000000c','Yoga Saputra',   'M',1441, 25,null),
  (13,'dddd0000-0000-0000-0000-00000000000d','Dimas Aditya',   'M',1418, 16,'New. Be gentle.'),
  (14,'dddd0000-0000-0000-0000-00000000000e','Arif Setiawan',  'M',1395, 14,null);

-- The empty strings are not decoration. Supabase's auth service reads these
-- token columns into Go strings, and a NULL there makes sign-in fail with
-- "converting NULL to string is unsupported" — which looks like a wrong
-- password and is impossible to diagnose from the app.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token,
                        email_change, email_change_token_new,
                        raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated',
       lower(split_part(p.name, ' ', 1)) || '@demo.padelier.id',
       crypt('DemoPadel2026', gen_salt('bf')),
       now() - interval '120 days', now() - interval '120 days', now(),
       '', '', '', '',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('name', p.name)
from demo_people p;

-- And the identity row, for the same reason: without it the email provider
-- has nothing to match against and the password is never even checked.
insert into auth.identities (id, user_id, provider, provider_id, identity_data,
                             created_at, updated_at)
select gen_random_uuid(), p.id, 'email', p.id::text,
       jsonb_build_object('sub', p.id::text,
                          'email', lower(split_part(p.name, ' ', 1)) || '@demo.padelier.id',
                          'email_verified', true),
       now() - interval '120 days', now() - interval '120 days'
from demo_people p;

-- The trigger makes a bare profile; give each one a real rating and history
-- so the leaderboard and the profile screen have something to show.
update profiles pr
   set display_name = p.name,
       rating = p.rating,
       rating_deviation = case when p.games > 25 then 62 else 95 end,
       rating_games = p.games,
       bio = p.bio,
       onboarded_at = now() - interval '119 days',
       created_at = now() - interval '120 days'
  from demo_people p
 where pr.id = p.id;

-- --- The club ------------------------------------------------------------
insert into teams (id, name, owner_id)
values ('dddd0000-0000-0000-0000-0000000000f0','Ana''s Team','dddd0000-0000-0000-0000-000000000001');

insert into clubs (id, name, club_code, created_by, created_at)
values ('dddd0000-0000-0000-0000-0000000000c1','Kemang Padel Club','KEMANG',
        'dddd0000-0000-0000-0000-000000000001', now() - interval '118 days');

insert into club_members (club_id, user_id, role, joined_at)
select 'dddd0000-0000-0000-0000-0000000000c1', p.id,
       case p.n when 1 then 'owner' when 2 then 'admin' else 'member' end,
       now() - interval '118 days' + (p.n || ' days')::interval
from demo_people p;

-- --- Five Tuesdays, actually played --------------------------------------
do $$
declare
  v_tue    timestamptz;   -- most recent Tuesday already past
  v_when   timestamptz;
  v_sess   uuid;
  v_round  uuid;
  v_day    int;
  v_r      int;
  v_c      int;
  v_match  uuid;
  v_court  uuid[];
  v_order  uuid[];        -- players shuffled for this round
  v_a1 uuid; v_a2 uuid; v_b1 uuid; v_b2 uuid;
  v_sa int; v_sb int;
  v_share numeric;
  v_rank   int;
  v_prev   numeric;
  v_games  int;
  v_rating numeric;
  r record;
begin
  -- Anchor on a real Tuesday so a screenshot showing "Tue 25 Aug" is not a lie.
  --
  -- BUILT IN JAKARTA TIME, DELIBERATELY. The database runs in UTC, so a plain
  -- '19 hours' here is 19:00 UTC — which the app, rendering in the phone's
  -- timezone, draws as 02:00 on WEDNESDAY. A session called "Tuesday Night"
  -- displaying a Wednesday 2am start is the kind of detail that makes a
  -- screenshot look fabricated, because it is.
  v_tue := (date_trunc('week', (now() at time zone 'Asia/Jakarta'))
            + interval '1 day' + interval '19 hours') at time zone 'Asia/Jakarta';
  if v_tue >= now() then v_tue := v_tue - interval '7 days'; end if;

  -- Where each player's rating stood five weeks ago. The walk from here has
  -- to ARRIVE at the number stored on the profile — a sparkline that ends
  -- somewhere other than the rating printed above it is the first thing
  -- anyone looking at the screenshot would notice.
  drop table if exists run_rating;
  create temp table run_rating (user_id uuid primary key, rating numeric, games int default 0) on commit drop;
  insert into run_rating (user_id, rating, games)
    select id, round(rating - 30 - (random() * 40)), 0 from demo_people;

  for v_day in 1..5 loop
    v_sess  := ('dddd0000-0000-0000-0000-0000000000' || lpad((80 + v_day)::text, 2, '0'))::uuid;
    v_when  := v_tue - ((5 - v_day) || ' weeks')::interval;

    insert into sessions (id, team_id, name, format, scoring_format, ranking_basis,
                          scheduling_seed, status, join_code, public_token,
                          club_id, created_by, counts_for_league,
                          created_at, started_at, ended_at, ratings_applied, results_applied)
    values (v_sess, 'dddd0000-0000-0000-0000-0000000000f0',
            'Tuesday Night', case when v_day % 2 = 0 then 'mexicano' else 'americano' end,
            'fixed_21', 'points_first', v_day * 7717, 'ended',
            'KM' || lpad(v_day::text, 4, '0'), 'demo-tue-' || v_day,
            'dddd0000-0000-0000-0000-0000000000c1','dddd0000-0000-0000-0000-000000000001', true,
            v_when - interval '2 days', v_when, v_when + interval '2 hours',
            true, true);

    -- Three courts.
    v_court := array[]::uuid[];
    for v_c in 1..3 loop
      insert into courts (session_id, ordinal, display_name)
      values (v_sess, v_c, 'Court ' || v_c)
      returning id into v_match;              -- reusing the variable as scratch
      v_court := v_court || v_match;
    end loop;

    -- Twelve of the fourteen play each week; who sits out rotates, so nobody
    -- has a suspiciously perfect attendance record.
    insert into players (session_id, display_name, gender, linked_user_id, status, matches_played)
    select v_sess, p.name, p.gender, p.id, 'active', 6
      from demo_people p
     where p.n <> ((v_day * 3) % 14) + 1
       and p.n <> ((v_day * 5) % 14) + 1;

    -- Running tally for this session, filled in as matches are scored.
    drop table if exists tally;
    create temp table tally (player_id uuid primary key, user_id uuid,
                             points int default 0, wins int default 0, losses int default 0)
      on commit drop;
    insert into tally (player_id, user_id)
      select id, linked_user_id from players where session_id = v_sess;

    -- Six rounds, everybody on court every round.
    for v_r in 1..6 loop
      insert into rounds (session_id, sequence, status, generation_reason, seed_used, generated_at)
      values (v_sess, v_r, 'scored', case when v_r = 1 then 'initial' else 'next_round' end,
              v_day * 7717 + v_r, v_when + ((v_r - 1) * 18 || ' minutes')::interval)
      returning id into v_round;

      select array_agg(id order by random()) into v_order
        from players where session_id = v_sess;

      for v_c in 1..3 loop
        v_a1 := v_order[(v_c - 1) * 4 + 1];
        v_a2 := v_order[(v_c - 1) * 4 + 2];
        v_b1 := v_order[(v_c - 1) * 4 + 3];
        v_b2 := v_order[(v_c - 1) * 4 + 4];

        -- Stronger pair usually wins, not always. 21 is odd, so no draws —
        -- which is correct for fixed_21 and keeps the record columns honest.
        select 0.5 + least(0.12, greatest(-0.12,
                 (( (select coalesce(pr.rating,1500) from players pl join profiles pr on pr.id = pl.linked_user_id where pl.id = v_a1)
                  + (select coalesce(pr.rating,1500) from players pl join profiles pr on pr.id = pl.linked_user_id where pl.id = v_a2)
                  - (select coalesce(pr.rating,1500) from players pl join profiles pr on pr.id = pl.linked_user_id where pl.id = v_b1)
                  - (select coalesce(pr.rating,1500) from players pl join profiles pr on pr.id = pl.linked_user_id where pl.id = v_b2)
                 ) / 2400.0)))
             + (random() * 0.40 - 0.20)
          into v_share;

        v_sa := least(15, greatest(6, round(21 * v_share)::int));
        v_sb := 21 - v_sa;

        insert into matches (round_id, court_id, score_a, score_b, outcome, status, created_at, updated_at)
        values (v_round, v_court[v_c], v_sa, v_sb,
                case when v_sa > v_sb then 'win_a' else 'win_b' end, 'final',
                v_when + ((v_r - 1) * 18 || ' minutes')::interval,
                v_when + ((v_r - 1) * 18 + 16 || ' minutes')::interval)
        returning id into v_match;

        insert into match_participants (match_id, player_id, side) values
          (v_match, v_a1, 'A'), (v_match, v_a2, 'A'),
          (v_match, v_b1, 'B'), (v_match, v_b2, 'B');

        update tally set points = points + v_sa,
                         wins   = wins   + (case when v_sa > v_sb then 1 else 0 end),
                         losses = losses + (case when v_sa > v_sb then 0 else 1 end)
         where player_id in (v_a1, v_a2);
        update tally set points = points + v_sb,
                         wins   = wins   + (case when v_sb > v_sa then 1 else 0 end),
                         losses = losses + (case when v_sb > v_sa then 0 else 1 end)
         where player_id in (v_b1, v_b2);
      end loop;
    end loop;

    -- The league table, computed from the scores above rather than invented.
    v_rank := 0;
    for r in select t.*, dp.rating as base_rating, dp.games as total_games
               from tally t
               join demo_people dp on dp.id = t.user_id
              order by t.points desc, t.wins desc loop
      v_rank := v_rank + 1;

      insert into session_results (session_id, club_id, user_id, session_date, rank,
                                   field_size, player_count, placement_points, podium_bonus,
                                   wins, losses, draws, scored_points)
      values (v_sess, 'dddd0000-0000-0000-0000-0000000000c1', r.user_id, v_when,
              v_rank, 12, 12,
              13 - v_rank,
              case v_rank when 1 then 3 when 2 then 2 when 3 then 1 else 0 end,
              r.wins, r.losses, 0, r.points);

      -- A Brownian bridge, not a straight line: each week pulls a fifth of the
      -- remaining distance plus a good shove of noise, so a bad night shows as
      -- a dip. Week five is the exact remainder, so the line ends on the
      -- rating the profile displays.
      select rr.rating, rr.games into v_prev, v_games from run_rating rr where rr.user_id = r.user_id;
      if v_day = 5 then
        v_rating := r.base_rating;
      else
        v_rating := round(v_prev
                          + (r.base_rating - v_prev) / (6 - v_day)
                          + (case when v_rank <= 4 then 7 when v_rank >= 9 then -7 else 0 end)
                          + (random() * 18 - 9));
      end if;
      update run_rating set rating = v_rating, games = v_games + 6 where user_id = r.user_id;
      insert into rating_history (user_id, session_id, rating, delta, created_at,
                                  rating_before, rd_before, vol_before, games_before, games_after)
      values (r.user_id, v_sess, round(v_rating), round(v_rating - v_prev),
              v_when + interval '2 hours',
              round(v_prev), 78, 0.06,
              v_games, v_games + 6);
    end loop;

    drop table tally;
  end loop;
end $$;

-- Two people sit out each week, so for them the walk above stops early. Take
-- the rating and the games count from the last row of their own history, so
-- the number at the top of a profile always matches the end of its own graph.
update profiles pr
   set rating = last.rating,
       rating_games = last.games_after,
       rating_deviation = case when last.games_after >= 30 then 62 else 95 end
  from (
    select distinct on (user_id) user_id, rating, games_after
      from rating_history where user_id::text like 'dddd%'
     order by user_id, created_at desc
  ) last
 where pr.id = last.user_id;

-- --- Next Tuesday, with a waiting list -----------------------------------
-- Twelve places, fourteen answers: the cap and the queue both visible in one
-- screenshot, which is the whole point of that feature.
insert into club_events (id, club_id, title, scheduled_at, location, notes, status,
                         created_by, court_count, duration_hours, max_players, cost, slug)
select 'dddd0000-0000-0000-0000-0000000000e9','dddd0000-0000-0000-0000-0000000000c1',
       'Tuesday Night',
       v.next_tue,
       'Kemang Padel, Court 1–3', 'Bring a spare grip. Cash or transfer on the night.',
       'scheduled','dddd0000-0000-0000-0000-000000000001',
       3, 2.0, 12, 'IDR 120k', 'kemang-tuesday-night'
from (
  -- Jakarta time, for the same reason the played sessions are: 19:00 UTC would
  -- render as 02:00 Wednesday on the phone.
  select case when (date_trunc('week', (now() at time zone 'Asia/Jakarta'))
                    + interval '1 day' + interval '19 hours') at time zone 'Asia/Jakarta' > now()
              then (date_trunc('week', (now() at time zone 'Asia/Jakarta'))
                    + interval '1 day' + interval '19 hours') at time zone 'Asia/Jakarta'
              else (date_trunc('week', (now() at time zone 'Asia/Jakarta'))
                    + interval '8 days' + interval '19 hours') at time zone 'Asia/Jakarta'
         end as next_tue
) v;

insert into club_event_rsvps (event_id, user_id, response, responded_at)
select 'dddd0000-0000-0000-0000-0000000000e9', p.id,
       case when p.n <= 10 then 'in'
            when p.n <= 12 then 'waitlist'
            when p.n = 13  then 'maybe'
            else 'out' end,
       now() - ((15 - p.n) || ' hours')::interval
from demo_people p;


drop table demo_people;

-- --- What you should see -------------------------------------------------
select (select count(*) from profiles        where id::text like 'dddd%')        as members,
       (select count(*) from sessions        where id::text like 'dddd%')        as past_sessions,
       (select count(*) from rounds          where session_id::text like 'dddd%') as rounds,
       (select count(*) from matches m join rounds rd on rd.id = m.round_id
                                        where rd.session_id::text like 'dddd%')  as matches,
       (select count(*) from session_results where user_id::text like 'dddd%')   as result_rows,
       (select count(*) from rating_history  where user_id::text like 'dddd%')   as rating_points,
       (select count(*) from club_event_rsvps where user_id::text like 'dddd%')  as rsvps;
