-- ---------------------------------------------------------------------
-- sync_participant_removal_test.sql
--
-- Reproduces the 18 Sep 2026 corruption and proves 0067 fixes it.
--
-- Run against 0066 -> the swap cases FAIL: the player is seated twice.
-- Run against 0067 -> everything passes.
--
-- The shape of the real failure: an 8-player round drawn onto two courts,
-- then a lineup swap moves one player between courts. The device sends the
-- new seat; the old row was never removed, so the round showed 3 v 5.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test');
insert into teams (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Host Team');
insert into sessions (id, team_id, name, format, scoring_format, ranking_basis,
                      status, join_code, public_token, scheduling_seed, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Swap Night', 'mexicano', 'fixed_21', 'points_first', 'live',
        '123456', 'tok-1', 42, '11111111-1111-1111-1111-111111111111');

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 58);
end; $$;

create or replace function t(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null;
  exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when v_err is null then 'PASS' else 'FAIL' end,
    rpad(p_name, 58), coalesce('-> ' || left(v_err, 50), '');
end; $$;

/** How many courts is this player seated on, in round 1? */
create or replace function courts_for(p_player text) returns int
language sql security definer as $$
  select count(distinct mp.match_id)::int
    from match_participants mp
    join matches m on m.id = mp.match_id
   where m.round_id = 'eeeeeeee-0000-0000-0000-000000000001'
     and mp.player_id = p_player::uuid;
$$;

/** Seats on one court. */
create or replace function seats_on(p_match text) returns int
language sql security definer as $$
  select count(*)::int from match_participants where match_id = p_match::uuid;
$$;

set client_min_messages = notice;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

\echo ''
\echo '=== The initial draw: 8 players, two courts, 2v2 each ==='

select t('first replication',
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

select expect('Court 1 has 4 seats', $$ seats_on('ffffffff-0000-0000-0000-000000000001') = 4 $$);
select expect('Court 2 has 4 seats', $$ seats_on('ffffffff-0000-0000-0000-000000000002') = 4 $$);

\echo ''
\echo '=== The host swaps ana (Court 1) with eve (Court 2) ==='
\echo '    The device sends each player at their NEW seat only.'

select t('replication after the swap',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "matches":[
        {"id":"ffffffff-0000-0000-0000-000000000001","round_id":"eeeeeeee-0000-0000-0000-000000000001",
         "court_id":"cccccccc-0000-0000-0000-000000000001","status":"not_started"},
        {"id":"ffffffff-0000-0000-0000-000000000002","round_id":"eeeeeeee-0000-0000-0000-000000000001",
         "court_id":"cccccccc-0000-0000-0000-000000000002","status":"not_started"}],
      "participants":[
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000e","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000b","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000c","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000d","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-00000000000a","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-00000000000f","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-000000000010","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-000000000011","side":"B"}]}
     $j$::jsonb) $$);

select expect('ana is on ONE court     <-- THE BUG',
  $$ courts_for('d0000000-0000-0000-0000-00000000000a') = 1 $$);
select expect('eve is on ONE court     <-- THE BUG',
  $$ courts_for('d0000000-0000-0000-0000-00000000000e') = 1 $$);
select expect('Court 1 still has 4 seats, not 5  <-- THE BUG',
  $$ seats_on('ffffffff-0000-0000-0000-000000000001') = 4 $$);
select expect('Court 2 still has 4 seats, not 5  <-- THE BUG',
  $$ seats_on('ffffffff-0000-0000-0000-000000000002') = 4 $$);
select expect('ana is now on Court 2',
  $$ exists (select 1 from match_participants
              where match_id = 'ffffffff-0000-0000-0000-000000000002'
                and player_id = 'd0000000-0000-0000-0000-00000000000a') $$);
select expect('and no longer on Court 1',
  $$ not exists (select 1 from match_participants
                  where match_id = 'ffffffff-0000-0000-0000-000000000001'
                    and player_id = 'd0000000-0000-0000-0000-00000000000a') $$);

\echo ''
\echo '=== Pulling a rester on: the player who sat down must lose their seat ==='

select t('replication after a rester swap',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "participants":[
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000e","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000b","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000c","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-000000000011","side":"B"}]}
     $j$::jsonb) $$);

select expect('dan lost his seat on Court 1',
  $$ courts_for('d0000000-0000-0000-0000-00000000000d') = 0 $$);
select expect('Court 1 has exactly 4 seats',
  $$ seats_on('ffffffff-0000-0000-0000-000000000001') = 4 $$);

\echo ''
\echo '=== Silence about a court is NOT an instruction to empty it ==='
\echo '    (this is why the delete is scoped, not blanket)'

select t('a payload that mentions only Court 1',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "participants":[
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000e","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000b","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-00000000000c","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"d0000000-0000-0000-0000-000000000011","side":"B"}]}
     $j$::jsonb) $$);

select expect('Court 2 is untouched, still 4 seats',
  $$ seats_on('ffffffff-0000-0000-0000-000000000002') = 4 $$);

select t('a payload with NO participants at all',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"}} $j$::jsonb) $$);

select expect('both courts survive an empty push',
  $$ seats_on('ffffffff-0000-0000-0000-000000000001') = 4
     and seats_on('ffffffff-0000-0000-0000-000000000002') = 4 $$);

\echo ''
\echo '=== A side change still works (the original upsert behaviour) ==='

select t('same players, sides flipped on Court 2',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "participants":[
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-00000000000a","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-00000000000f","side":"B"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-000000000010","side":"A"},
        {"match_id":"ffffffff-0000-0000-0000-000000000002","player_id":"d0000000-0000-0000-0000-000000000011","side":"A"}]}
     $j$::jsonb) $$);

select expect('ana is on side B now',
  $$ (select side from match_participants
       where match_id = 'ffffffff-0000-0000-0000-000000000002'
         and player_id = 'd0000000-0000-0000-0000-00000000000a') = 'B' $$);
select expect('Court 2 still has 4 seats',
  $$ seats_on('ffffffff-0000-0000-0000-000000000002') = 4 $$);

reset role;
\echo ''
