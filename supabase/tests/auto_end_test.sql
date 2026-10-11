-- ---------------------------------------------------------------------
-- auto_end_test.sql -- proves 0072: idle nights end themselves, a phone
-- that missed the end cannot undo it, and reopening undoes the ratings.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test'),
  ('22222222-2222-2222-2222-222222222222', 'player@test'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@test'),
  ('44444444-4444-4444-4444-444444444444', 'admin@test');
update profiles set is_admin = true where id = '44444444-4444-4444-4444-444444444444';
insert into teams (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'T');
insert into clubs (id, name, club_code) values ('a1000000-0000-0000-0000-000000000001', 'Club', 'CLUB01');

-- (1) idle 13 h   (2) active 1 h ago   (3) a draft, idle for days   (4) for reopen
insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis,
                      status, join_code, public_token, scheduling_seed, created_by, started_at)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'Forgotten', 'mexicano', 'fixed_21', 'points_first', 'live',  '100001', 't1', 1, '11111111-1111-1111-1111-111111111111', now() - interval '15 hours'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'Tonight',   'mexicano', 'fixed_21', 'points_first', 'live',  '100002', 't2', 1, '11111111-1111-1111-1111-111111111111', now() - interval '2 hours'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'Lobby',     'mexicano', 'fixed_21', 'points_first', 'draft', '100003', 't3', 1, '11111111-1111-1111-1111-111111111111', null),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Rated', 'mexicano', 'fixed_21', 'points_first', 'ended', '100004', 't4', 1, '11111111-1111-1111-1111-111111111111', now() - interval '1 day');

update sessions set last_activity_at = now() - interval '13 hours' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
update sessions set last_activity_at = now() - interval '1 hour'   where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update sessions set updated_at = now() - interval '5 days', last_activity_at = now() - interval '5 days', created_at = now() - interval '5 days'
 where id = 'bbbbbbbb-0000-0000-0000-000000000003';
update sessions set ended_at = now() - interval '20 hours', ratings_applied = true, results_applied = true
 where id = 'bbbbbbbb-0000-0000-0000-000000000004';

insert into rounds (id, session_id, sequence, status, generation_reason, seed_used) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 1, 'in_progress', 'x', 1);
insert into courts (id, session_id, ordinal, display_name) values
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 1, 'Court 1');
insert into matches (id, round_id, court_id, status) values
  ('ffffffff-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'not_started');

-- Session 4 was rated: the player went 1500 -> 1540, the host 1500 -> 1480.
update profiles set rating = 1540, rating_games = 4 where id = '22222222-2222-2222-2222-222222222222';
update profiles set rating = 1480, rating_games = 4 where id = '11111111-1111-1111-1111-111111111111';
insert into rating_history (user_id, session_id, rating, delta, rating_before, rd_before, vol_before, games_before, games_after) values
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000004', 1540,  40, 1500, 350, 0.06, 0, 4),
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000004', 1480, -20, 1500, 350, 0.06, 0, 4);
insert into session_results (session_id, club_id, user_id, session_date, rank, field_size, player_count, placement_points) values
  ('bbbbbbbb-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', now(), 1, 4, 4, 10);

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 64);
end; $$;
create or replace function t(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null; exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when v_err is null then 'PASS' else 'FAIL' end, rpad(p_name, 64), coalesce('-> ' || left(v_err, 60), '');
end; $$;
create or replace function refused(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null; exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when v_err is not null then 'PASS' else 'FAIL' end, rpad(p_name, 64), coalesce('-> ' || left(v_err, 60), '(was allowed)');
end; $$;
create or replace function s(p_id text) returns sessions
language sql security definer as $$ select * from sessions where id = p_id::uuid $$;
create or replace function as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false)::text is not null; $$;
grant execute on function expect(text, text), t(text, text), refused(text, text), s(text), as_user(uuid) to authenticated;

set client_min_messages = notice;

\echo ''
\echo '=== The sweep (runs as the database owner, like pg_cron) ==='
select expect('sweep ends exactly one session', $$ auto_end_idle_sessions() = 1 $$);
select expect('the idle night is ended, flagged auto_ended',
  $$ (s('bbbbbbbb-0000-0000-0000-000000000001')).status = 'ended' and (s('bbbbbbbb-0000-0000-0000-000000000001')).auto_ended $$);
select expect('ended_at is when it went quiet, not when the sweep ran',
  $$ (s('bbbbbbbb-0000-0000-0000-000000000001')).ended_at < now() - interval '12 hours' $$);
select expect('tonight''s session is untouched', $$ (s('bbbbbbbb-0000-0000-0000-000000000002')).status = 'live' $$);
select expect('a draft lobby is untouched', $$ (s('bbbbbbbb-0000-0000-0000-000000000003')).status = 'draft' $$);
select expect('running it again ends nothing more', $$ auto_end_idle_sessions() = 0 $$);

set role authenticated;

\echo ''
\echo '=== A phone that missed the end cannot undo it ==='
select as_user('11111111-1111-1111-1111-111111111111');
select t('host phone pushes "live" for the auto-ended night',
  $$ select sync_session_state('{"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"}}'::jsonb) $$);
select expect('still ended                                <-- THE BUG BEFORE 0072',
  $$ (s('bbbbbbbb-0000-0000-0000-000000000001')).status = 'ended'
     and (s('bbbbbbbb-0000-0000-0000-000000000001')).ended_at is not null $$);
select t('host phone ends it itself, with its own time',
  $$ select sync_session_state(jsonb_build_object('session', jsonb_build_object(
       'id','bbbbbbbb-0000-0000-0000-000000000001','status','ended','ended_at', now() - interval '12 hours 30 minutes'))) $$);
select expect('the phone''s end time wins, and it is no longer "auto"',
  $$ (s('bbbbbbbb-0000-0000-0000-000000000001')).ended_at > now() - interval '12 hours 31 minutes'
     and not (s('bbbbbbbb-0000-0000-0000-000000000001')).auto_ended $$);

\echo ''
\echo '=== Activity keeps a night alive ==='
update sessions set last_activity_at = null where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select t('host pushes tonight''s session',
  $$ select sync_session_state('{"session":{"id":"bbbbbbbb-0000-0000-0000-000000000002","status":"live"}}'::jsonb) $$);
select expect('a push records activity', $$ (s('bbbbbbbb-0000-0000-0000-000000000002')).last_activity_at > now() - interval '1 minute' $$);
reset role;
update sessions set last_activity_at = now() - interval '2 hours' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update matches set score_a = 15, score_b = 6, status = 'final' where id = 'ffffffff-0000-0000-0000-000000000002';
select expect('a score records activity', $$ (s('bbbbbbbb-0000-0000-0000-000000000002')).last_activity_at > now() - interval '1 minute' $$);
set role authenticated;

\echo ''
\echo '=== The host''s phone asks on launch ==='
select as_user('33333333-3333-3333-3333-333333333333');
select refused('a stranger cannot end someone''s session', $$ select end_session_if_idle('bbbbbbbb-0000-0000-0000-000000000002') $$);
select as_user('11111111-1111-1111-1111-111111111111');
select expect('an active night stays live', $$ end_session_if_idle('bbbbbbbb-0000-0000-0000-000000000002') = 'live' $$);
reset role;
update sessions set last_activity_at = now() - interval '13 hours' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
set role authenticated;
select expect('an idle one is ended', $$ end_session_if_idle('bbbbbbbb-0000-0000-0000-000000000002') = 'ended' $$);
select refused('nobody signed in can run the sweep', $$ select auto_end_idle_sessions() $$);

\echo ''
\echo '=== Reopening undoes the ratings and the league rows ==='
select as_user('33333333-3333-3333-3333-333333333333');
select refused('a stranger cannot reopen', $$ select reopen_session('bbbbbbbb-0000-0000-0000-000000000004') $$);
select as_user('11111111-1111-1111-1111-111111111111');
select t('host reopens', $$ select reopen_session('bbbbbbbb-0000-0000-0000-000000000004') $$);
select expect('live again, flags cleared',
  $$ (s('bbbbbbbb-0000-0000-0000-000000000004')).status = 'live'
     and (s('bbbbbbbb-0000-0000-0000-000000000004')).ended_at is null
     and not (s('bbbbbbbb-0000-0000-0000-000000000004')).ratings_applied
     and not (s('bbbbbbbb-0000-0000-0000-000000000004')).results_applied
     and (s('bbbbbbbb-0000-0000-0000-000000000004')).reopened_at is not null $$);
reset role;
select expect('player rating back to 1500 / 0 games',
  $$ (select rating = 1500 and rating_games = 0 from profiles where id = '22222222-2222-2222-2222-222222222222') $$);
select expect('host rating back to 1500',
  $$ (select rating = 1500 from profiles where id = '11111111-1111-1111-1111-111111111111') $$);
select expect('its rating history and league rows are gone',
  $$ not exists (select 1 from rating_history where session_id = 'bbbbbbbb-0000-0000-0000-000000000004')
     and not exists (select 1 from session_results where session_id = 'bbbbbbbb-0000-0000-0000-000000000004') $$);
set role authenticated;

select t('a STALE end from before the reopen arrives',
  $$ select sync_session_state(jsonb_build_object('session', jsonb_build_object(
       'id','bbbbbbbb-0000-0000-0000-000000000004','status','ended','ended_at', now() - interval '20 hours'))) $$);
select expect('the reopen stands', $$ (s('bbbbbbbb-0000-0000-0000-000000000004')).status = 'live'
                                     and (s('bbbbbbbb-0000-0000-0000-000000000004')).ended_at is null $$);
select t('the host ends it again, for real',
  $$ select sync_session_state(jsonb_build_object('session', jsonb_build_object(
       'id','bbbbbbbb-0000-0000-0000-000000000004','status','ended','ended_at', now()))) $$);
select expect('ended again', $$ (s('bbbbbbbb-0000-0000-0000-000000000004')).status = 'ended' $$);

select as_user('44444444-4444-4444-4444-444444444444');
select t('an admin can reopen too', $$ select reopen_session('bbbbbbbb-0000-0000-0000-000000000004') $$);
reset role;
select expect('and it is logged', $$ exists (select 1 from admin_actions where action = 'reopen_session'
                                             and target_id = 'bbbbbbbb-0000-0000-0000-000000000004') $$);
set role authenticated;
select as_user('11111111-1111-1111-1111-111111111111');
select refused('reopening a live session is refused', $$ select reopen_session('bbbbbbbb-0000-0000-0000-000000000004') $$);
