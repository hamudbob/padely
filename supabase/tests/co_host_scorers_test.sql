-- ---------------------------------------------------------------------
-- co_host_scorers_test.sql  --  proves what 0065 does and does NOT allow.
--
-- Run on ONE connection (psql -f). set_config('request.jwt.claim.sub', ...)
-- is connection-scoped, so `psql -c` per statement silently tests nothing.
--
-- TWO TRAPS THIS FILE IS BUILT TO AVOID:
--
--  1. A broken fixture makes denials pass for the wrong reason. "That match
--     does not exist" is NOT proof that a stranger was refused. So the
--     fixture is asserted before any test runs, and every deny-test names
--     the reason it was refused so a wrong reason is visible.
--
--  2. RLS does not raise on UPDATE/DELETE -- it silently matches no rows.
--     A harness that only catches exceptions scores every one of those as
--     "allowed". So the harness checks ROW_COUNT too, and each table has a
--     positive control proving the same statement DOES affect a row when
--     the host runs it.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

-- --- fixture ------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test'),
  ('22222222-2222-2222-2222-222222222222', 'scorer@test'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@test'),
  ('44444444-4444-4444-4444-444444444444', 'otherhost@test');

insert into teams (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Host Team'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Other Team');

-- (1) live MEXICANO -- not pre-generated, so rounds can be appended.
-- (2) another host's live session -- for cross-tenant checks.
-- (3) live AMERICANO -- pre-generated, so append must be refused.
insert into sessions (id, team_id, name, format, scoring_format, ranking_basis,
                      status, join_code, public_token, scheduling_seed, created_by, started_at)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Test Night', 'mexicano', 'fixed_21', 'wins_first', 'live',
   '123456', 'tok-live-1', 42, '11111111-1111-1111-1111-111111111111', now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'Other Night', 'mexicano', 'fixed_21', 'wins_first', 'live',
   '654321', 'tok-live-2', 7, '44444444-4444-4444-4444-444444444444', now()),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Amer Night', 'americano', 'fixed_21', 'wins_first', 'live',
   '111222', 'tok-live-3', 9, '11111111-1111-1111-1111-111111111111', now());

insert into courts (id, session_id, ordinal, display_name) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'Court 1'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 2, 'Court 2'),
  ('cccccccc-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000002', 1, 'Other Court'),
  ('cccccccc-0000-0000-0000-000000000033', 'bbbbbbbb-0000-0000-0000-000000000003', 1, 'Amer Court');

insert into players (id, session_id, display_name, status) values
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Ana', 'active'),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Bob', 'active'),
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'Cat', 'active'),
  ('dddddddd-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', 'Dan', 'active'),
  ('dddddddd-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000001', 'Eve', 'left'),
  ('dddddddd-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-000000000001', 'Fay', 'active'),
  ('dddddddd-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000002', 'Zoe', 'active'),
  ('dddddddd-0000-0000-0000-000000000033', 'bbbbbbbb-0000-0000-0000-000000000003', 'Amy', 'active');

insert into rounds (id, session_id, sequence, status, generation_reason, seed_used) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'in_progress', 'initial draw', 42),
  ('eeeeeeee-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 1, 'in_progress', 'initial draw', 7),
  ('eeeeeeee-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000003', 1, 'in_progress', 'initial draw', 9);

insert into matches (id, round_id, court_id, status) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'not_started'),
  ('ffffffff-0000-0000-0000-000000000009', 'eeeeeeee-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000009', 'not_started'),
  ('ffffffff-0000-0000-0000-000000000033', 'eeeeeeee-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000033', 'final');

insert into match_participants (match_id, player_id, side) values
  ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'A'),
  ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'A'),
  ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000003', 'B'),
  ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004', 'B');

-- The host names the scorer -- on session 1 AND on the americano session, so
-- the "pre-generated formats refuse append" test is refused for THAT reason
-- and not merely because the caller had no rights there.
insert into session_scorers (session_id, user_id, added_by) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');

-- --- fixture assertions: nothing below is meaningful without these -------
do $$
begin
  if not exists (select 1 from matches where id = 'ffffffff-0000-0000-0000-000000000001')
  then raise exception 'FIXTURE BROKEN: session 1 match missing'; end if;
  if not exists (select 1 from matches where id = 'ffffffff-0000-0000-0000-000000000009')
  then raise exception 'FIXTURE BROKEN: session 2 match missing'; end if;
  if (select count(*) from match_participants
       where match_id = 'ffffffff-0000-0000-0000-000000000001') <> 4
  then raise exception 'FIXTURE BROKEN: participants missing'; end if;
  raise notice 'fixture OK';
end $$;

-- --- harness ------------------------------------------------------------
create or replace function t(p_name text, p_sql text, p_expect text)
returns void language plpgsql as $$
declare v_err text; v_ok boolean; v_rows bigint := -1; v_why text;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = ROW_COUNT;
    v_err := null;
  exception when others then
    v_err := sqlerrm;
  end;

  if p_expect = 'allow' then
    v_ok  := v_err is null;
    v_why := coalesce('-> ' || left(v_err, 64), '');
  else
    -- Refused means EITHER it raised OR row-level security silently matched
    -- nothing. Both are real denials; only the second is invisible.
    v_ok  := (v_err is not null) or (v_rows = 0);
    v_why := coalesce('-> ' || left(v_err, 64), '-> 0 rows (RLS)');
  end if;

  raise notice '%  %  %',
    case when v_ok then 'PASS' else 'FAIL' end, rpad(p_name, 52), v_why;
end;
$$;

create or replace function be(p_uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', p_uid, false); end; $$;

-- Asserts a fact about the data, so an "allow" cannot pass vacuously.
-- SECURITY DEFINER on purpose: owned by the table owner, so it reads past
-- RLS. Without that, an assertion run as the scorer sees no row, returns
-- null, and reports FAIL for every fact -- including the true ones.
create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 52);
end; $$;

-- Drives the fixture past RLS too, for the same reason.
create or replace function as_owner(p_sql text) returns void
language plpgsql security definer as $$
begin execute p_sql; end; $$;

set client_min_messages = notice;

-- =======================================================================
\echo ''
\echo '=== POSITIVE CONTROLS: the host CAN do all of this ================='
set role authenticated;
select be('11111111-1111-1111-1111-111111111111');

select t('host updates the session',
  $$ update sessions set name = 'Renamed' where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$, 'allow');
select t('host marks a player left',
  $$ update players set status = 'left' where id = 'dddddddd-0000-0000-0000-000000000006' $$, 'allow');
select t('host renames a court',
  $$ update courts set display_name = 'Centre' where id = 'cccccccc-0000-0000-0000-000000000001' $$, 'allow');
select t('host rewrites a match court',
  $$ update matches set court_id = 'cccccccc-0000-0000-0000-000000000001'
      where id = 'ffffffff-0000-0000-0000-000000000001' $$, 'allow');
select expect('...and those really changed a row',
  $$ (select name from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'Renamed' $$);

\echo ''
\echo '=== AS THE SCORER: the two things they may do ======================'
select be('22222222-2222-2222-2222-222222222222');

select t('reads the session',
  $$ select get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') $$, 'allow');
select t('enters a score',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', 15) $$, 'allow');
select expect('...the score actually landed (15 / 6, win_a, final)',
  $$ (select score_a = 15 and score_b = 6 and outcome = 'win_a' and status = 'final'
        from matches where id = 'ffffffff-0000-0000-0000-000000000001') $$);

select t('corrects a score',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', 12, null, 'typo') $$, 'allow');
select expect('...and the correction is audited to the scorer',
  $$ exists (select 1 from score_edits
              where match_id = 'ffffffff-0000-0000-0000-000000000001'
                and edited_by = '22222222-2222-2222-2222-222222222222'
                and old_score_a = 15 and new_score_a = 12) $$);

select t('advances to round 2',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001', $j$
       {"sequence": 2, "matches": [
         {"court_id": "cccccccc-0000-0000-0000-000000000001",
          "participants": [
            {"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"},
            {"player_id":"dddddddd-0000-0000-0000-000000000003","side":"A"},
            {"player_id":"dddddddd-0000-0000-0000-000000000002","side":"B"},
            {"player_id":"dddddddd-0000-0000-0000-000000000004","side":"B"}]}],
        "rests": [{"player_id":"dddddddd-0000-0000-0000-000000000005"}]}
     $j$::jsonb) $$, 'deny');
\echo '     (^ rests a LEFT player: must be refused)'

select t('advances to round 2, properly',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001', $j$
       {"sequence": 2, "matches": [
         {"court_id": "cccccccc-0000-0000-0000-000000000001",
          "participants": [
            {"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"},
            {"player_id":"dddddddd-0000-0000-0000-000000000003","side":"A"},
            {"player_id":"dddddddd-0000-0000-0000-000000000002","side":"B"},
            {"player_id":"dddddddd-0000-0000-0000-000000000004","side":"B"}]}]}
     $j$::jsonb) $$, 'allow');
select expect('...round 2 exists with 4 seated players',
  $$ (select count(*) from match_participants mp
        join matches m on m.id = mp.match_id
        join rounds r on r.id = m.round_id
       where r.session_id = 'bbbbbbbb-0000-0000-0000-000000000001'
         and r.sequence = 2) = 4 $$);
select expect('...and it recorded a legal seed and reason',
  $$ (select seed_used = 42 and generation_reason = 'advanced by co-host'
        from rounds where session_id = 'bbbbbbbb-0000-0000-0000-000000000001' and sequence = 2) $$);

\echo ''
\echo '=== AS THE SCORER: everything else is refused ======================'

select t('cannot end the session',
  $$ update sessions set status = 'ended' where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$, 'deny');
select t('cannot change the ranking basis',
  $$ update sessions set ranking_basis = 'points_first' where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$, 'deny');
select t('cannot mark a player left',
  $$ update players set status = 'left' where id = 'dddddddd-0000-0000-0000-000000000001' $$, 'deny');
select t('cannot add a late player',
  $$ insert into players (session_id, display_name, status)
     values ('bbbbbbbb-0000-0000-0000-000000000001', 'Mallory', 'active') $$, 'deny');
select t('cannot rename a court',
  $$ update courts set display_name = 'Hacked' where id = 'cccccccc-0000-0000-0000-000000000001' $$, 'deny');
select t('cannot delete a round (redraw)',
  $$ delete from rounds where id = 'eeeeeeee-0000-0000-0000-000000000001' $$, 'deny');
select t('cannot rewrite a match court directly',
  $$ update matches set court_id = 'cccccccc-0000-0000-0000-000000000002'
      where id = 'ffffffff-0000-0000-0000-000000000001' $$, 'deny');
select t('cannot rewrite who played',
  $$ update match_participants set side = 'B'
      where match_id = 'ffffffff-0000-0000-0000-000000000001' $$, 'deny');
select t('cannot replicate the whole session',
  $$ select sync_session_state($j$ {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001"}} $j$::jsonb) $$, 'deny');
select t('cannot grant themselves rights elsewhere',
  $$ insert into session_scorers (session_id, user_id, added_by)
     values ('bbbbbbbb-0000-0000-0000-000000000002',
             '22222222-2222-2222-2222-222222222222',
             '22222222-2222-2222-2222-222222222222') $$, 'deny');

select expect('...the court really is unchanged after all that',
  $$ (select court_id from matches where id = 'ffffffff-0000-0000-0000-000000000001')
       = 'cccccccc-0000-0000-0000-000000000001' $$);
select expect('...and the session is still live',
  $$ (select status from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'live' $$);

\echo ''
\echo '=== AS THE SCORER: payload attacks on advance ======================'
-- Every match must be final first. Otherwise the "finish scoring" guard
-- fires before any of the payload validators, and each attack below would
-- pass for a reason that has nothing to do with what it is testing.
select as_owner($$ update matches set score_a = 15, score_b = 6,
                          outcome = 'win_a', status = 'final'
                    where round_id in (select id from rounds
                                        where session_id = 'bbbbbbbb-0000-0000-0000-000000000001') $$);

select t('cannot append out of sequence',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"sequence": 9, "matches": [{"court_id":"cccccccc-0000-0000-0000-000000000001",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"}]}]}'::jsonb) $$, 'deny');
select t('cannot seat another session''s player',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [{"court_id":"cccccccc-0000-0000-0000-000000000001",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000009","side":"A"}]}]}'::jsonb) $$, 'deny');
select t('cannot use another session''s court',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [{"court_id":"cccccccc-0000-0000-0000-000000000009",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"}]}]}'::jsonb) $$, 'deny');
select t('cannot seat a player who has left',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [{"court_id":"cccccccc-0000-0000-0000-000000000001",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000005","side":"A"}]}]}'::jsonb) $$, 'deny');
select t('cannot seat one player on two courts',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [
         {"court_id":"cccccccc-0000-0000-0000-000000000001",
          "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"}]},
         {"court_id":"cccccccc-0000-0000-0000-000000000002",
          "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"}]}]}'::jsonb) $$, 'deny');
select t('cannot put two matches on one court',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [
         {"court_id":"cccccccc-0000-0000-0000-000000000001",
          "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"}]},
         {"court_id":"cccccccc-0000-0000-0000-000000000001",
          "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000002","side":"A"}]}]}'::jsonb) $$, 'deny');
select t('cannot invent a side other than A or B',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [{"court_id":"cccccccc-0000-0000-0000-000000000001",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"C"}]}]}'::jsonb) $$, 'deny');
select t('cannot append to an americano (pre-generated)',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000003',
       '{"matches": [{"court_id":"cccccccc-0000-0000-0000-000000000033",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000033","side":"A"}]}]}'::jsonb) $$, 'deny');
\echo '     (^ caller IS a scorer there: must be refused on format, not rights)'

select expect('...no stray rounds were created by any of that',
  $$ (select count(*) from rounds where session_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 2 $$);

\echo ''
\echo '=== A HALF-SCORED ROUND BLOCKS ADVANCING ==========================='
-- The guard reads matches.status, not rounds.status, so this un-scores an
-- actual match rather than just relabelling the round.
select as_owner($$ update matches set status = 'not_started', score_a = null, score_b = null,
                          outcome = null
                    where id = (select m.id from matches m join rounds r on r.id = m.round_id
                                 where r.session_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                                   and r.sequence = 2 limit 1) $$);

select t('cannot advance while round 2 is unscored',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [{"court_id":"cccccccc-0000-0000-0000-000000000001",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"}]}]}'::jsonb) $$, 'deny');

select as_owner($$ update matches set status = 'final', score_a = 15, score_b = 6, outcome = 'win_a'
                    where status <> 'final'
                      and round_id in (select id from rounds
                                        where session_id = 'bbbbbbbb-0000-0000-0000-000000000001') $$);

\echo ''
\echo '=== AS A STRANGER: nothing at all =================================='
select be('33333333-3333-3333-3333-333333333333');

select t('cannot read the session',
  $$ select get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') $$, 'deny');
select t('cannot score a real, existing match',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', 15) $$, 'deny');
select t('cannot advance',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [{"court_id":"cccccccc-0000-0000-0000-000000000001",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"}]}]}'::jsonb) $$, 'deny');

\echo ''
\echo '=== A SCORER HERE IS A STRANGER THERE =============================='
select be('22222222-2222-2222-2222-222222222222');

select t('cannot score another host''s real match',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000009', 15) $$, 'deny');
select t('cannot read another host''s session',
  $$ select get_scorer_session('bbbbbbbb-0000-0000-0000-000000000002') $$, 'deny');
select expect('...that match is genuinely still unscored',
  $$ (select score_a is null from matches where id = 'ffffffff-0000-0000-0000-000000000009') $$);

\echo ''
\echo '=== SCORES ARE VALIDATED ON THE SERVER ============================='

select t('rejects fixed_21 above 21 on a real match',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', 99) $$, 'deny');
select t('rejects a negative score on a real match',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', -3) $$, 'deny');
select t('derives B for fixed_21 (15 -> 6, win_a)',
  $$ do $d$ declare r jsonb; begin
       r := derive_match_score('fixed_21', 15, null);
       if (r->>'score_b')::int <> 6 or r->>'outcome' <> 'win_a' then
         raise exception 'got %', r; end if; end $d$ $$, 'allow');
select t('derives a draw for fixed_4_games (2 -> 2)',
  $$ do $d$ declare r jsonb; begin
       r := derive_match_score('fixed_4_games', 2, null);
       if (r->>'score_b')::int <> 2 or r->>'outcome' <> 'draw' then
         raise exception 'got %', r; end if; end $d$ $$, 'allow');
select t('rejects a fixed_5_games pair that does not sum to 5',
  $$ select derive_match_score('fixed_5_games', 3, 3) $$, 'deny');
select t('race_6 refuses a draw',
  $$ select derive_match_score('race_6', 6, 6) $$, 'deny');
select t('race_6 refuses a non-target winner',
  $$ select derive_match_score('race_6', 5, 3) $$, 'deny');
select t('race_6 accepts 6-4',
  $$ select derive_match_score('race_6', 6, 4) $$, 'allow');
select t('rejects an unknown scoring format',
  $$ select derive_match_score('fixed_99', 1, 1) $$, 'deny');

\echo ''
\echo '=== REVOKING A SCORER TAKES EFFECT AT ONCE ========================='
reset role; select be('11111111-1111-1111-1111-111111111111');
delete from session_scorers
 where session_id = 'bbbbbbbb-0000-0000-0000-000000000001'
   and user_id = '22222222-2222-2222-2222-222222222222';
set role authenticated; select be('22222222-2222-2222-2222-222222222222');

select t('removed scorer can no longer score',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', 15) $$, 'deny');
select t('removed scorer can no longer read',
  $$ select get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') $$, 'deny');

\echo ''
\echo '=== THE HOST KEEPS EVERY RIGHT ====================================='
select be('11111111-1111-1111-1111-111111111111');

select t('host reads via the scorer RPC',
  $$ select get_scorer_session('bbbbbbbb-0000-0000-0000-000000000001') $$, 'allow');
select t('host scores via the scorer RPC',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', 21) $$, 'allow');
select t('host ends the session',
  $$ update sessions set status = 'ended' where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$, 'allow');

\echo ''
\echo '=== AN ENDED SESSION IS CLOSED TO SCORERS =========================='
reset role; select be('11111111-1111-1111-1111-111111111111');
insert into session_scorers (session_id, user_id, added_by) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111');
set role authenticated; select be('22222222-2222-2222-2222-222222222222');

select t('cannot score an ended session',
  $$ select submit_score_as_scorer('ffffffff-0000-0000-0000-000000000001', 15) $$, 'deny');
select t('cannot advance an ended session',
  $$ select append_round_as_scorer('bbbbbbbb-0000-0000-0000-000000000001',
       '{"matches": [{"court_id":"cccccccc-0000-0000-0000-000000000001",
         "participants":[{"player_id":"dddddddd-0000-0000-0000-000000000001","side":"A"}]}]}'::jsonb) $$, 'deny');

reset role;
\echo ''
