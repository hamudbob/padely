-- ---------------------------------------------------------------------
-- co_host_safe_sync_test.sql  --  proves 0071: a host's push cannot undo
-- a co-host's work, and the host still outranks the co-host.
--
-- Against 0070 (0065 only) the cases marked <-- THE RISK fail: the host's
-- next push deletes the co-host's round and puts back stale scores.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test'),
  ('22222222-2222-2222-2222-222222222222', 'scorer@test'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@test');
insert into profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Hamud')
  on conflict (id) do update set display_name = excluded.display_name;
insert into teams (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Host Team');
insert into sessions (id, team_id, name, format, scoring_format, ranking_basis,
                      status, join_code, public_token, scheduling_seed, created_by, started_at)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Co-host Night', 'mexicano', 'fixed_21', 'points_first', 'live',
        '123456', 'tok-1', 42, '11111111-1111-1111-1111-111111111111', now());

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 62);
end; $$;

create or replace function t(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null;
  exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when v_err is null then 'PASS' else 'FAIL' end,
    rpad(p_name, 62), coalesce('-> ' || left(v_err, 60), '');
end; $$;

create or replace function refused(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null;
  exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when v_err is not null then 'PASS' else 'FAIL' end,
    rpad(p_name, 62), coalesce('-> ' || left(v_err, 60), '(was allowed)');
end; $$;

create or replace function m(p_id text) returns matches
language sql security definer as $$ select * from matches where id = p_id::uuid $$;
create or replace function r(p_id text) returns rounds
language sql security definer as $$ select * from rounds where id = p_id::uuid $$;

create or replace function as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false)::text is not null; $$;

grant execute on function expect(text, text), t(text, text), refused(text, text),
  m(text), r(text), as_user(uuid) to authenticated;

set client_min_messages = notice;
set role authenticated;

\echo ''
\echo '=== Setup: the host phone pushes round 1, two courts ==='
select as_user('11111111-1111-1111-1111-111111111111');

select t('first push',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "players":[
        {"id":"d0000000-0000-0000-0000-00000000000a","display_name":"ana","status":"active"},
        {"id":"d0000000-0000-0000-0000-00000000000b","display_name":"bob","status":"active"},
        {"id":"d0000000-0000-0000-0000-00000000000c","display_name":"cat","status":"active"},
        {"id":"d0000000-0000-0000-0000-00000000000d","display_name":"dan","status":"active"},
        {"id":"d0000000-0000-0000-0000-00000000000e","display_name":"eve","status":"active"},
        {"id":"d0000000-0000-0000-0000-00000000000f","display_name":"fay","status":"active"},
        {"id":"d0000000-0000-0000-0000-000000000010","display_name":"gil","status":"active"},
        {"id":"d0000000-0000-0000-0000-000000000011","display_name":"hal","status":"active"}],
      "courts":[
        {"id":"cccccccc-0000-0000-0000-000000000001","ordinal":1,"display_name":"Court 1","available":true},
        {"id":"cccccccc-0000-0000-0000-000000000002","ordinal":2,"display_name":"Court 2","available":true}],
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"in_progress",
                 "generation_reason":"initial draw","seed_used":42}],
      "matches":[
        {"id":"ffffffff-0000-0000-0000-000000000001","round_id":"eeeeeeee-0000-0000-0000-000000000001",
         "court_id":"cccccccc-0000-0000-0000-000000000001","status":"not_started"},
        {"id":"ffffffff-0000-0000-0000-000000000002","round_id":"eeeeeeee-0000-0000-0000-000000000001",
         "court_id":"cccccccc-0000-0000-0000-000000000002","status":"not_started"}],
      "participants":[
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000a","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000b","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000c","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000d","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-00000000000e","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-00000000000f","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-000000000010","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-000000000011","side":"B"}]}
     $j$::jsonb) $$);

select t('host names a co-host',
  $$ insert into session_scorers (session_id, user_id, added_by)
     values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
             '11111111-1111-1111-1111-111111111111') $$);

\echo ''
\echo '=== The co-host scores Court 1 ==='
select as_user('22222222-2222-2222-2222-222222222222');
select t('co-host enters 15', $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', 15) $$);
select expect('Court 1 is 15-6 and final',
  $$ (m('ffffffff-0000-0000-0000-000000000001')).score_a = 15
     and (m('ffffffff-0000-0000-0000-000000000001')).score_b = 6
     and (m('ffffffff-0000-0000-0000-000000000001')).status = 'final' $$);
select expect('stamped with who and when',
  $$ (m('ffffffff-0000-0000-0000-000000000001')).scored_by = '22222222-2222-2222-2222-222222222222'
     and (m('ffffffff-0000-0000-0000-000000000001')).scored_at is not null $$);
select expect('round 1 is in_progress while Court 2 is unscored',
  $$ (r('eeeeeeee-0000-0000-0000-000000000001')).status = 'in_progress' $$);

\echo ''
\echo '=== The host phone, not yet pulled, pushes again ==='
select as_user('11111111-1111-1111-1111-111111111111');

select t('push with Court 1 still blank on the phone',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "matches":[{"id":"ffffffff-0000-0000-0000-000000000001","round_id":"eeeeeeee-0000-0000-0000-000000000001",
         "court_id":"cccccccc-0000-0000-0000-000000000001","status":"not_started"}]}
     $j$::jsonb) $$);
select expect('the co-host''s 15-6 survives a blank push',
  $$ (m('ffffffff-0000-0000-0000-000000000001')).score_a = 15
     and (m('ffffffff-0000-0000-0000-000000000001')).status = 'final' $$);

select t('an OLD app pushes 10-11 with no timestamp',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "matches":[{"id":"ffffffff-0000-0000-0000-000000000001","round_id":"eeeeeeee-0000-0000-0000-000000000001",
         "court_id":"cccccccc-0000-0000-0000-000000000001","status":"final","score_a":10,"score_b":11,"outcome":"win_b"}]}
     $j$::jsonb) $$);
select expect('an untimed push cannot overwrite the co-host  <-- THE RISK',
  $$ (m('ffffffff-0000-0000-0000-000000000001')).score_a = 15 $$);

select t('a score tapped an hour BEFORE the co-host''s',
  $$ select sync_session_state(jsonb_build_object(
       'session', jsonb_build_object('id','bbbbbbbb-0000-0000-0000-000000000001','status','live'),
       'matches', jsonb_build_array(jsonb_build_object(
          'id','ffffffff-0000-0000-0000-000000000001','round_id','eeeeeeee-0000-0000-0000-000000000001',
          'court_id','cccccccc-0000-0000-0000-000000000001','status','final',
          'score_a',10,'score_b',11,'outcome','win_b','scored_at', now() - interval '1 hour')))) $$);
select expect('an older score loses                          <-- THE RISK',
  $$ (m('ffffffff-0000-0000-0000-000000000001')).score_a = 15
     and (m('ffffffff-0000-0000-0000-000000000001')).outcome = 'win_a' $$);

select t('an OLD app scores Court 2, which nobody else touched',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "matches":[{"id":"ffffffff-0000-0000-0000-000000000002","round_id":"eeeeeeee-0000-0000-0000-000000000001",
         "court_id":"cccccccc-0000-0000-0000-000000000002","status":"final","score_a":21,"score_b":0,"outcome":"win_a"}]}
     $j$::jsonb) $$);
select expect('an untimed push still writes an untouched match',
  $$ (m('ffffffff-0000-0000-0000-000000000002')).score_a = 21
     and (m('ffffffff-0000-0000-0000-000000000002')).scored_by = '11111111-1111-1111-1111-111111111111' $$);

\echo ''
\echo '=== The co-host advances to round 2 ==='
select as_user('22222222-2222-2222-2222-222222222222');
select t('co-host appends round 2',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001', $j$
     {"id":"eeeeeeee-0000-0000-0000-000000000002","sequence":2,"seed_used":44,
      "matches":[{"id":"ffffffff-0000-0000-0000-000000000003","court_id":"cccccccc-0000-0000-0000-000000000001",
        "participants":[
          {"player_id":"d0000000-0000-0000-0000-00000000000a","side":"A"},
          {"player_id":"d0000000-0000-0000-0000-00000000000e","side":"A"},
          {"player_id":"d0000000-0000-0000-0000-00000000000b","side":"B"},
          {"player_id":"d0000000-0000-0000-0000-00000000000f","side":"B"}]}],
      "rests":[{"player_id":"d0000000-0000-0000-0000-00000000000c"}]}
     $j$::jsonb) $$);
select expect('round 2 is in_progress and marked as the co-host''s',
  $$ (r('eeeeeeee-0000-0000-0000-000000000002')).status = 'in_progress'
     and (r('eeeeeeee-0000-0000-0000-000000000002')).added_by_scorer = '22222222-2222-2222-2222-222222222222' $$);
select expect('round 1 is now scored',
  $$ (r('eeeeeeee-0000-0000-0000-000000000001')).status = 'scored' $$);

select t('co-host scores round 2', $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000003', 12) $$);
select expect('scoring the only court of round 2 marks it scored',
  $$ (r('eeeeeeee-0000-0000-0000-000000000002')).status = 'scored' $$);

\echo ''
\echo '=== The host phone, which has never seen round 2, pushes ==='
select as_user('11111111-1111-1111-1111-111111111111');
select t('push carrying only round 1',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"in_progress",
                 "generation_reason":"initial draw","seed_used":42}]}
     $j$::jsonb) $$);
select expect('the co-host''s round 2 is NOT deleted          <-- THE RISK',
  $$ (r('eeeeeeee-0000-0000-0000-000000000002')).id is not null $$);
select expect('and neither is its scored match',
  $$ (m('ffffffff-0000-0000-0000-000000000003')).score_a = 12 $$);

\echo ''
\echo '=== The host still outranks the co-host ==='
select t('a newer host score replaces the co-host''s',
  $$ select sync_session_state(jsonb_build_object(
       'session', jsonb_build_object('id','bbbbbbbb-0000-0000-0000-000000000001','status','live'),
       'matches', jsonb_build_array(jsonb_build_object(
          'id','ffffffff-0000-0000-0000-000000000001','round_id','eeeeeeee-0000-0000-0000-000000000001',
          'court_id','cccccccc-0000-0000-0000-000000000001','status','final',
          'score_a',9,'score_b',12,'outcome','win_b','scored_at', now() + interval '1 minute')))) $$);
select expect('host''s 9-12 wins, and is attributed to the host',
  $$ (m('ffffffff-0000-0000-0000-000000000001')).score_a = 9
     and (m('ffffffff-0000-0000-0000-000000000001')).outcome = 'win_b'
     and (m('ffffffff-0000-0000-0000-000000000001')).scored_by = '11111111-1111-1111-1111-111111111111' $$);

select t('host deletes round 2 by naming it',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"in_progress",
                 "generation_reason":"initial draw","seed_used":42}],
      "discarded_round_ids":["eeeeeeee-0000-0000-0000-000000000002"]}
     $j$::jsonb) $$);
select expect('a named round is deleted',
  $$ (r('eeeeeeee-0000-0000-0000-000000000002')).id is null $$);

select as_user('22222222-2222-2222-2222-222222222222');
select t('co-host draws round 2 again',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001', $j$
     {"id":"eeeeeeee-0000-0000-0000-000000000003","sequence":2,
      "matches":[{"court_id":"cccccccc-0000-0000-0000-000000000001",
        "participants":[
          {"player_id":"d0000000-0000-0000-0000-00000000000a","side":"A"},
          {"player_id":"d0000000-0000-0000-0000-00000000000e","side":"A"},
          {"player_id":"d0000000-0000-0000-0000-00000000000b","side":"B"},
          {"player_id":"d0000000-0000-0000-0000-00000000000f","side":"B"}]}]}
     $j$::jsonb) $$);

select as_user('11111111-1111-1111-1111-111111111111');
select t('host phone draws its OWN round 2 (offline race)',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"scored",
                 "generation_reason":"initial draw","seed_used":42},
                {"id":"eeeeeeee-0000-0000-0000-000000000004","sequence":2,"status":"in_progress",
                 "generation_reason":"host draw","seed_used":44}]}
     $j$::jsonb) $$);
select expect('the push did not abort, and the host''s round stands',
  $$ (r('eeeeeeee-0000-0000-0000-000000000004')).id is not null
     and (r('eeeeeeee-0000-0000-0000-000000000003')).id is null $$);

\echo ''
\echo '=== What the co-host can see ==='
select as_user('22222222-2222-2222-2222-222222222222');
select expect('my_scorer_sessions lists the night, with the host''s name',
  $$ jsonb_array_length(my_scorer_sessions()) = 1
     and my_scorer_sessions() -> 0 ->> 'host_name' = 'Hamud' $$);
select expect('get_scorer_session: is_host false, players carry joined_at',
  $$ (get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') -> 'session' ->> 'is_host') = 'false'
     and (get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') -> 'players' -> 0 ->> 'joined_at') is not null $$);
select expect('get_scorer_session: matches carry scored_at, rounds their seed',
  $$ exists (select 1 from jsonb_array_elements(get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') -> 'matches') x
              where x ->> 'scored_at' is not null)
     and (get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') -> 'rounds' -> 0 ->> 'seed_used') is not null $$);
select refused('the co-host cannot push the session graph',
  $$ select sync_session_state('{"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"ended"}}'::jsonb) $$);
select refused('nobody can call the score helper directly',
  $$ select incoming_score_wins(1, now(), now(), null, null) $$);

select as_user('11111111-1111-1111-1111-111111111111');
select expect('get_scorer_session: is_host true for the host',
  $$ (get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') -> 'session' ->> 'is_host') = 'true' $$);

select as_user('33333333-3333-3333-3333-333333333333');
select expect('a stranger co-hosts nothing',
  $$ jsonb_array_length(my_scorer_sessions()) = 0 $$);

\echo ''
\echo '=== Once the night ends, the co-host card disappears ==='
select as_user('11111111-1111-1111-1111-111111111111');
select t('host ends', $$ select sync_session_state('{"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"ended","ended_at":"2026-10-11T22:00:00Z"}}'::jsonb) $$);
select as_user('22222222-2222-2222-2222-222222222222');
select expect('my_scorer_sessions is empty after the end',
  $$ jsonb_array_length(my_scorer_sessions()) = 0 $$);
select refused('and the co-host can no longer score',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000002', 3) $$);
