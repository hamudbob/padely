\set QUIET on
set client_min_messages = warning;
-- Badges (0087). Run on a copy with every migration through 0087.

-- People: A hosts and owns the club; B, C, D play; E..L only join the club.
insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000000'||lpad(g::text,2,'0'))::uuid, 'u'||g||'@t' from generate_series(1,12) g;
update profiles set display_name = 'U'||right(id::text,2);
update profiles set rating_deviation = 60 where id = '00000000-0000-0000-0000-000000000001';
insert into teams (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','T');
insert into clubs (id, name, club_code, created_by) values ('c1000000-0000-0000-0000-000000000001','PLER','PLER01','00000000-0000-0000-0000-000000000001');
insert into club_members (club_id, user_id, role, joined_at)
select 'c1000000-0000-0000-0000-000000000001', ('00000000-0000-0000-0000-0000000000'||lpad(g::text,2,'0'))::uuid,
       case when g = 1 then 'owner' else 'member' end, timestamptz '2026-09-01' + make_interval(days => g)
  from generate_series(1,10) g
on conflict (club_id, user_id) do update set role = excluded.role, joined_at = excluded.joined_at;

-- A small factory for nights and matches.
create function t_night(p_id int, p_start timestamptz, p_club boolean default true) returns uuid language plpgsql as $$
declare v uuid := ('5e000000-0000-0000-0000-0000000000'||lpad(p_id::text,2,'0'))::uuid;
begin
  insert into sessions (id, team_id, name, format, scoring_format, ranking_basis, status, join_code, public_token, scheduling_seed,
                        created_by, started_at, ended_at, club_id)
  values (v, 'aaaaaaaa-0000-0000-0000-000000000001', 'Night '||p_id, 'americano', 'fixed_21', 'points_first', 'ended',
          lpad(p_id::text,6,'0'), 'tok'||p_id, 1, '00000000-0000-0000-0000-000000000001', p_start, p_start + interval '3 hours',
          case when p_club then 'c1000000-0000-0000-0000-000000000001'::uuid end);
  insert into courts (id, session_id, ordinal, display_name) values (v, v, 1, 'C1');
  insert into players (id, session_id, display_name, linked_user_id)
  select ('9'||lpad(p_id::text,2,'0')||'00000-0000-0000-0000-0000000000'||lpad(g::text,2,'0'))::uuid, v, 'P'||g,
         ('00000000-0000-0000-0000-0000000000'||lpad(g::text,2,'0'))::uuid
    from generate_series(1,4) g;
  return v;
end $$;
-- a1/a2 vs b1/b2 are user numbers 1..4.
create function t_match(p_night int, p_seq int, a1 int, a2 int, b1 int, b2 int, sa int, sb int, p_at timestamptz) returns void language plpgsql as $$
declare v uuid := ('5e000000-0000-0000-0000-0000000000'||lpad(p_night::text,2,'0'))::uuid;
        r uuid := gen_random_uuid(); m uuid := gen_random_uuid();
        pl text := '9'||lpad(p_night::text,2,'0')||'00000-0000-0000-0000-0000000000';
begin
  insert into rounds (id, session_id, sequence, status, generation_reason, seed_used) values (r, v, p_seq, 'scored', 'x', 1);
  insert into matches (id, round_id, court_id, status, score_a, score_b, outcome, scored_at, scored_by)
  values (m, r, v, 'final', sa, sb, case when sa > sb then 'win_a' when sb > sa then 'win_b' else 'draw' end, p_at,
          '00000000-0000-0000-0000-000000000001');
  insert into match_participants (match_id, player_id, side) values
    (m, (pl||lpad(a1::text,2,'0'))::uuid, 'A'), (m, (pl||lpad(a2::text,2,'0'))::uuid, 'A'),
    (m, (pl||lpad(b1::text,2,'0'))::uuid, 'B'), (m, (pl||lpad(b2::text,2,'0'))::uuid, 'B');
end $$;
create function t_result(p_night int, p_user int, p_rank int, p_date timestamptz) returns void language sql as $$
  insert into session_results (session_id, club_id, user_id, session_date, rank, field_size, player_count, placement_points, podium_bonus, wins)
  values (('5e000000-0000-0000-0000-0000000000'||lpad(p_night::text,2,'0'))::uuid, 'c1000000-0000-0000-0000-000000000001',
          ('00000000-0000-0000-0000-0000000000'||lpad(p_user::text,2,'0'))::uuid, p_date, p_rank, 4, 4, 5 - p_rank,
          case p_rank when 1 then 3 when 2 then 2 when 3 then 1 else 0 end, 0);
$$;
create function has(p_user int, p_badge text, p_level int default 1, p_club boolean default null) returns boolean language sql as $$
  select exists (select 1 from player_badges where user_id = ('00000000-0000-0000-0000-0000000000'||lpad(p_user::text,2,'0'))::uuid
                  and badge = p_badge and level = p_level
                  and (p_club is null or (club_id is not null) = p_club));
$$;
create function prog(p_user int, p_badge text) returns numeric language sql as $$
  select sum(value) from badge_progress where user_id = ('00000000-0000-0000-0000-0000000000'||lpad(p_user::text,2,'0'))::uuid and badge = p_badge;
$$;

-- Night 1, Sep 2026 (Season 1): A wins.
select t_night(1, '2026-09-08 13:00+00');
select t_match(1, 1, 1,2, 3,4, 21,10, '2026-09-08 13:30+00');
select t_result(1,1,1,'2026-09-08 13:00+00'); select t_result(1,2,2,'2026-09-08 13:00+00');
select t_result(1,3,3,'2026-09-08 13:00+00'); select t_result(1,4,4,'2026-09-08 13:00+00');

-- Night 2, Mon 5 Oct (Season 2): A wins all four, one 21–0, ends after
-- midnight Jakarta; A+D beat B+C who were rated 200 higher.
select t_night(2, '2026-10-05 13:00+00');
select t_match(2, 1, 1,4, 2,3, 21,0,  '2026-10-05 14:00+00');
select t_match(2, 2, 1,2, 3,4, 21,15, '2026-10-05 15:00+00');
select t_match(2, 3, 1,3, 2,4, 21,18, '2026-10-05 16:00+00');
select t_match(2, 4, 1,4, 2,3, 21,19, '2026-10-05 17:30+00');
select t_result(2,1,1,'2026-10-05 13:00+00'); select t_result(2,2,2,'2026-10-05 13:00+00');
select t_result(2,3,3,'2026-10-05 13:00+00'); select t_result(2,4,4,'2026-10-05 13:00+00');
insert into rating_history (user_id, session_id, rating, delta, rating_before, rd_before, created_at) values
  ('00000000-0000-0000-0000-000000000001','5e000000-0000-0000-0000-000000000002',1580,80,1500,80,'2026-10-05 18:00+00'),
  ('00000000-0000-0000-0000-000000000002','5e000000-0000-0000-0000-000000000002',1690,-10,1700,80,'2026-10-05 18:00+00'),
  ('00000000-0000-0000-0000-000000000003','5e000000-0000-0000-0000-000000000002',1690,-10,1700,80,'2026-10-05 18:00+00'),
  ('00000000-0000-0000-0000-000000000004','5e000000-0000-0000-0000-000000000002',1510,10,1500,80,'2026-10-05 18:00+00');

-- Night 3, Mon 12 Oct 07:30 Jakarta (early bird); Night 4 the same day: a
-- double header, and A's third title in a row (a hat-trick).
select t_night(3, '2026-10-12 00:30+00');
select t_match(3, 1, 1,2, 3,4, 21,11, '2026-10-12 01:00+00');
select t_result(3,1,1,'2026-10-12 00:30+00'); select t_result(3,2,2,'2026-10-12 00:30+00');
select t_night(4, '2026-10-12 12:00+00', false);
select t_match(4, 1, 2,3, 1,4, 21,11, '2026-10-12 12:30+00');

-- A Call-up A posted that filled every spot, and an invite B accepted.
insert into club_events (id, club_id, title, scheduled_at, created_by, max_players)
values ('e1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Tue','2026-10-20 12:00+00','00000000-0000-0000-0000-000000000001',2);
insert into club_event_rsvps (event_id, user_id, response) values
  ('e1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','in'),
  ('e1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','in');
insert into club_invites (club_id, inviter_id, invitee_id, status, decided_at)
values ('c1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','accepted','2026-10-01');

-- --- Seasons, as the app counts them ---
select case when string_agg(n||':'||to_char(s_start at time zone 'UTC','YYYY-MM'), ' ' order by n) like '1:2026-09 2:2026-10 3:2026-11%'
  then 'PASS  seasons start at the first league night, monthly' else 'FAIL  seasons '||string_agg(n||':'||to_char(s_start at time zone 'UTC','YYYY-MM'), ' ' order by n) end
  from badge_club_seasons('c1000000-0000-0000-0000-000000000001', '2026-11-19');
insert into club_season_rules (club_id, starts_at, length) values ('c1000000-0000-0000-0000-000000000001','2026-11-01','3_month')
  on conflict do nothing;
select case when string_agg(to_char(s_start at time zone 'UTC','YYYY-MM')||'..'||to_char(s_end at time zone 'UTC','YYYY-MM'), ' ' order by n)
             = '2026-09..2026-10 2026-10..2026-11 2026-11..2027-02'
  then 'PASS  a change of length starts its own seasons' else 'FAIL  rule change '||string_agg(to_char(s_start at time zone 'UTC','YYYY-MM')||'..'||to_char(s_end at time zone 'UTC','YYYY-MM'), ' ' order by n) end
  from badge_club_seasons('c1000000-0000-0000-0000-000000000001', '2026-11-19');
delete from club_season_rules where club_id = 'c1000000-0000-0000-0000-000000000001' and starts_at = '2026-11-01';

-- --- Past nights count, quietly ---
-- (Setting up the club above already told the owner about Founder 10: the
-- join trigger. Start clean so only the backfill is measured.)
delete from notifications where type = 'badge';
select refresh_all_badges(false) is not null;
select case when not exists (select 1 from notifications where type = 'badge') then 'PASS  catching up on the past sends nothing' else 'FAIL  backfill notified' end;

select case when has(1,'nights_played',1) and not has(1,'nights_played',10) and prog(1,'nights_played') = 4
  then 'PASS  Nights played 1, four nights counted' else 'FAIL  nights '||coalesce(prog(1,'nights_played')::text,'-') end;
select case when has(1,'unbeaten_night',1) and not has(1,'unbeaten_night',2) then 'PASS  Unbeaten night ×1 (4 of 4)' else 'FAIL  unbeaten' end;
select case when has(1,'clean_sheet',1) and not has(2,'clean_sheet',1) then 'PASS  Clean sheet for the 21–0 winner only' else 'FAIL  clean sheet' end;
select case when has(1,'giant_slayer') and has(4,'giant_slayer') and not has(2,'giant_slayer') then 'PASS  Giant-slayer for A and D' else 'FAIL  giant' end;
select case when has(1,'big_climb') and not has(4,'big_climb') then 'PASS  Big climb at +80, not +10' else 'FAIL  climb' end;
select case when has(1,'competitor') and not has(1,'master') then 'PASS  Competitor at 1580 settled' else 'FAIL  competitor' end;
select case when has(2,'master') = false and has(2,'competitor') = false
  then 'PASS  no tier while still provisional (RD 350)' else 'FAIL  provisional got a tier' end;
select case when has(1,'night_owl') then 'PASS  Night owl: last score 00:30 Jakarta' else 'FAIL  owl' end;
select case when has(1,'early_bird') and has(1,'double_header') then 'PASS  Early bird and Double header' else 'FAIL  bird/double' end;
select case when not has(1,'marathon') then 'PASS  no Marathon under 12 matches' else 'FAIL  marathon' end;
select case when has(1,'host',1) and prog(1,'host') = 4 and not has(2,'host',1) then 'PASS  Host 1 for the one who ran them' else 'FAIL  host' end;
select case when prog(1,'mixer') = 3 then 'PASS  Mixer counts different partners (3)' else 'FAIL  mixer '||coalesce(prog(1,'mixer')::text,'-') end;

select case when has(1,'club_nights',1,true) and has(1,'night_champion',1,true) and prog(1,'podiums') = 3
  then 'PASS  Club nights 1, Night champion 1, 3 podiums so far' else 'FAIL  club basics' end;
select case when has(1,'hat_trick',1,true) and not has(1,'hat_trick',2,true) then 'PASS  Hat-trick ×1 for three in a row' else 'FAIL  hat-trick' end;
select case when has(1,'season_champion',1,true) and has(1,'season_champion',2,true) and has(1,'back_to_back',1,true)
  then 'PASS  Season champion ×2 and Back-to-back' else 'FAIL  seasons' end;
select case when has(2,'season_podium',2,true) and has(2,'season_regular',2,true) and not has(2,'season_champion',1,true)
  then 'PASS  runner-up: Season podium ×2, Season regular ×2' else 'FAIL  runner-up' end;
select case when not has(3,'season_regular',3,true) then 'PASS  the season in progress gives nothing yet' else 'FAIL  current season' end;
select case when has(1,'founder',10,true) and not has(2,'founder',10,true) then 'PASS  Founder 10 for the owner only' else 'FAIL  founder' end;
select case when has(1,'recruiter',1,true) then 'PASS  Recruiter 1' else 'FAIL  recruiter' end;
select case when has(1,'full_house',1,true) then 'PASS  Full house 1' else 'FAIL  full house' end;
select case when prog(1,'scorer') = 6 and not has(1,'scorer',25,true) then 'PASS  Scorer counts scores at club nights only (6 of 25)' else 'FAIL  scorer '||coalesce(prog(1,'scorer')::text,'-') end;
select case when (select earned_at from player_badges where user_id = '00000000-0000-0000-0000-000000000001' and badge = 'nights_played' and level = 1) = '2026-09-08 13:00+00'
  then 'PASS  dated by the night that earned it' else 'FAIL  date' end;

-- --- New badges notify, once ---
select t_match(4, 2, 1,2, 3,4, 21,0, '2026-10-12 13:00+00'); -- A's second clean sheet
select refresh_badges('00000000-0000-0000-0000-000000000001') = 1;
select case when (select count(*) from notifications where type = 'badge' and user_id = '00000000-0000-0000-0000-000000000001') = 1
             and (select body from notifications where type = 'badge' and user_id = '00000000-0000-0000-0000-000000000001') = 'Clean sheet ×2'
  then 'PASS  one notification: "Clean sheet ×2"' else 'FAIL  notify '||coalesce((select string_agg(title||' / '||coalesce(body,''), ';') from notifications where type='badge'),'none') end;
select refresh_badges('00000000-0000-0000-0000-000000000001') = 0;
select case when (select count(*) from notifications where type = 'badge') = 1 then 'PASS  nothing new, nothing sent' else 'FAIL  sent again' end;

-- --- Kept even if the facts change ---
delete from matches where score_b = 0;
select refresh_badges('00000000-0000-0000-0000-000000000001', false) is not null;
select case when has(1,'clean_sheet',2) then 'PASS  a badge stays when a score is corrected' else 'FAIL  badge taken away' end;

-- --- The end of a night refreshes everyone in it ---
select t_night(5, '2026-11-02 12:00+00');
update sessions set status = 'live' where id = '5e000000-0000-0000-0000-000000000005';
select t_match(5, 1, 3,4, 1,2, 21,0, '2026-11-02 12:30+00');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false) is not null;
update sessions set status = 'ended' where id = '5e000000-0000-0000-0000-000000000005';
select case when has(3,'clean_sheet',1) and has(4,'clean_sheet',1)
             and exists (select 1 from notifications where type = 'badge' and user_id = '00000000-0000-0000-0000-000000000003')
  then 'PASS  ending a night gives its players their badges, with a notification' else 'FAIL  end-of-night refresh' end;

-- --- Founder updates when someone joins ---
insert into club_members (club_id, user_id, role) values ('c1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','member');
select case when prog(1,'founder') = 11 then 'PASS  a new member updates the owner' else 'FAIL  founder refresh '||coalesce(prog(1,'founder')::text,'-') end;

-- --- Reading ---
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false) is not null;
set role authenticated;
select case when jsonb_array_length(get_badges('00000000-0000-0000-0000-000000000001')->'earned') >= 20
             and get_badges('00000000-0000-0000-0000-000000000001')->'clubs'->0->>'name' = 'PLER'
             and (get_badges('00000000-0000-0000-0000-000000000001')->'clubs'->0->>'owner')::boolean
  then 'PASS  anyone can read a profile''s badges, with the club' else 'FAIL  get_badges' end;
select case when (get_badges('00000000-0000-0000-0000-000000000001')->>'elite_seen')::boolean = false then 'PASS  Elite stays unnamed until someone gets it' else 'FAIL  elite_seen' end;
do $$ begin
  begin perform 1 from player_badges limit 1; raise warning 'FAIL  table readable'; exception when insufficient_privilege then raise warning 'PASS  the tables are closed; reads go through get_badges'; end;
  begin perform refresh_badges('00000000-0000-0000-0000-000000000001'); raise warning 'FAIL  refresh open'; exception when insufficient_privilege then raise warning 'PASS  nobody can refresh someone else'; end;
end $$;
select case when refresh_my_badges() >= 0 then 'PASS  a player can refresh their own' else 'FAIL  refresh_my' end;
reset role;
