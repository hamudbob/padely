-- ---------------------------------------------------------------------
-- sync_session_settings_test.sql
--
-- Reproduces the 15 Sep 2026 bug and proves 0066 fixes it.
--
-- Run against 0064 -> the first three cases FAIL (that is the bug).
-- Run against 0066 -> everything passes.
--
-- A test that has never been watched to fail proves nothing, so run it both
-- ways. One connection (psql -f): set_config is connection-scoped.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test');

insert into teams (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Host Team');

insert into clubs (id, name, created_by, club_code) values
  ('cbcbcbcb-0000-0000-0000-000000000001', 'Real Club', '11111111-1111-1111-1111-111111111111', 'AAA111'),
  ('cbcbcbcb-0000-0000-0000-000000000002', 'Other Club', '11111111-1111-1111-1111-111111111111', 'BBB222');

-- Exactly what createLobby writes: a DRAFT row, lobby-time settings, and no
-- started_at. The host has not finished choosing yet.
insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis,
                      status, join_code, public_token, scheduling_seed, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'cbcbcbcb-0000-0000-0000-000000000001',
        'mop', 'mexicano', 'fixed_21', 'points_first', 'draft',
        '123456', 'tok-1', 42, '11111111-1111-1111-1111-111111111111');

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 56);
end; $$;

create or replace function t(p_name text, p_sql text, p_expect text) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null;
  exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %',
    case when (p_expect = 'allow') = (v_err is null) then 'PASS' else 'FAIL' end,
    rpad(p_name, 56), coalesce('-> ' || left(v_err, 60), '');
end; $$;

set client_min_messages = notice;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

\echo ''
\echo '=== The host finishes the wizard and starts: best-of-4, wins-first ==='

select t('replication succeeds',
  $$ select sync_session_state($j$
     {
       "session": {
         "id": "bbbbbbbb-0000-0000-0000-000000000001",
         "name": "mop",
         "format": "mexicano",
         "scoring_format": "fixed_4_games",
         "ranking_basis": "wins_first",
         "status": "live",
         "started_at": "2026-09-15T10:00:00Z",
         "min_players_per_court": 4
       },
       "players": [
         {"id":"dddddddd-0000-0000-0000-000000000001","display_name":"nadil","status":"active"},
         {"id":"dddddddd-0000-0000-0000-000000000002","display_name":"dela","status":"active"}
       ],
       "courts":  [{"id":"cccccccc-0000-0000-0000-000000000001","ordinal":1,"display_name":"Court 1","available":true}],
       "rounds":  [{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"scored",
                    "generation_reason":"initial draw","seed_used":42}],
       "matches": [{"id":"ffffffff-0000-0000-0000-000000000001",
                    "round_id":"eeeeeeee-0000-0000-0000-000000000001",
                    "court_id":"cccccccc-0000-0000-0000-000000000001",
                    "score_a":3,"score_b":1,"outcome":"win_a","status":"final"}],
       "participants": [
         {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"},
         {"match_id":"ffffffff-0000-0000-0000-000000000001","player_id":"dddddddd-0000-0000-0000-000000000002","side":"B"}
       ]
     } $j$::jsonb) $$, 'allow');

-- THE BUG. All three fail against 0064.
select expect('scoring_format reaches the server  <-- THE BUG',
  $$ (select scoring_format from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'fixed_4_games' $$);
select expect('ranking_basis reaches the server   <-- THE BUG',
  $$ (select ranking_basis from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'wins_first' $$);
select expect('started_at reaches the server      <-- THE BUG',
  $$ (select started_at is not null from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') $$);

-- 0064 already did these. They must not regress.
select expect('status still replicates (0064 behaviour)',
  $$ (select status from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'live' $$);
select expect('the score still replicates (0064 behaviour)',
  $$ (select score_a = 3 and score_b = 1 and status = 'final'
        from matches where id = 'ffffffff-0000-0000-0000-000000000001') $$);

\echo ''
\echo '=== A malformed setting must never abort the push ==='
\echo '    (0064 exists because an abort here cost a host an evening)'

select t('a garbage scoring_format does not raise',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","scoring_format":"tennis","ranking_basis":"vibes",
                 "format":"quidditch","status":"banana","name":"x"},
      "matches":[{"id":"ffffffff-0000-0000-0000-000000000002",
                  "round_id":"eeeeeeee-0000-0000-0000-000000000001",
                  "court_id":"cccccccc-0000-0000-0000-000000000001",
                  "score_a":4,"score_b":0,"outcome":"win_a","status":"final"}]} $j$::jsonb) $$, 'allow');

select expect('...and the good settings survive it',
  $$ (select scoring_format = 'fixed_4_games' and ranking_basis = 'wins_first'
             and format = 'mexicano' and status = 'live' and name = 'mop'
        from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') $$);
select expect('...while the SCORES in that same push still landed',
  $$ (select score_a = 4 from matches where id = 'ffffffff-0000-0000-0000-000000000002') $$);

\echo ''
\echo '=== A replication must not move a session between clubs ==='

select t('a payload naming another club is accepted',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001",
                 "club_id":"cbcbcbcb-0000-0000-0000-000000000002",
                 "counts_for_league":true}} $j$::jsonb) $$, 'allow');
select expect('...but the club is unchanged',
  $$ (select club_id from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001')
       = 'cbcbcbcb-0000-0000-0000-000000000001' $$);

\echo ''
\echo '=== Settings the payload is silent about are left alone ==='

select t('a payload carrying only scores',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001"}} $j$::jsonb) $$, 'allow');
select expect('...leaves every setting as it was',
  $$ (select scoring_format = 'fixed_4_games' and ranking_basis = 'wins_first'
             and name = 'mop' and status = 'live' and started_at is not null
        from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') $$);

\echo ''
\echo '=== Ending the night still works ==='

select t('end-of-session push',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"ended",
                 "ended_at":"2026-09-15T12:00:00Z"}} $j$::jsonb) $$, 'allow');
select expect('...status ended and ended_at recorded',
  $$ (select status = 'ended' and ended_at is not null
        from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') $$);

reset role;
\echo ''
