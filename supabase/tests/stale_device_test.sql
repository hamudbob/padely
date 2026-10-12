-- ---------------------------------------------------------------------
-- stale_device_test.sql -- proves 0076: a device that is BEHIND cannot
-- delete or overwrite rounds it hasn't seen.
--
-- 12 Oct 2026: the night was on round 7 on the web; the host opened the
-- same session in the iPhone app, whose copy had stopped at round 1.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'host@test');
insert into teams (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'T');
insert into sessions (id, team_id, name, format, scoring_format, ranking_basis,
                      status, join_code, public_token, scheduling_seed, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Night', 'mexicano', 'fixed_21', 'points_first', 'live', '100001', 't1', 1,
        '11111111-1111-1111-1111-111111111111');
insert into courts (id, session_id, ordinal, display_name) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'Court 1');

-- Rounds 1-3 played, round 4 drawn but not scored yet.
insert into rounds (id, session_id, sequence, status, generation_reason, seed_used)
select ('eeeeeeee-0000-0000-0000-00000000000' || g)::uuid, 'bbbbbbbb-0000-0000-0000-000000000001', g,
       case when g < 4 then 'scored' else 'in_progress' end, 'x', g
  from generate_series(1, 4) g;
insert into matches (id, round_id, court_id, status, score_a, score_b, outcome)
select ('ffffffff-0000-0000-0000-00000000000' || g)::uuid, ('eeeeeeee-0000-0000-0000-00000000000' || g)::uuid,
       'cccccccc-0000-0000-0000-000000000001',
       case when g < 4 then 'final' else 'not_started' end,
       case when g < 4 then 15 end, case when g < 4 then 6 end, case when g < 4 then 'win_a' end
  from generate_series(1, 4) g;

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 66);
end; $$;
create or replace function t(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null; exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when v_err is null then 'PASS' else 'FAIL' end, rpad(p_name, 66), coalesce('-> ' || left(v_err, 60), '');
end; $$;
create or replace function seqs() returns text language sql security definer as
  $$ select string_agg(sequence::text || ':' || right(id::text, 2), ' ' order by sequence) from rounds
      where session_id = 'bbbbbbbb-0000-0000-0000-000000000001' $$;
grant execute on function expect(text, text), t(text, text), seqs() to authenticated;

set client_min_messages = notice;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false) is not null;

\echo ''
\echo '=== The phone that stopped at round 1 pushes (an app before 1.1: no tombstones) ==='
select t('stale push carrying round 1 only',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"in_progress","generation_reason":"x","seed_used":1}],
      "matches":[{"id":"ffffffff-0000-0000-0000-000000000001","round_id":"eeeeeeee-0000-0000-0000-000000000001",
                  "court_id":"cccccccc-0000-0000-0000-000000000001","status":"not_started"}]}
     $j$::jsonb) $$);
select expect('played rounds 2 and 3 survive              <-- LOST BEFORE 0076',
  $$ seqs() like '%2:02%' and seqs() like '%3:03%' $$);
select expect('and so does round 4, drawn but not scored  <-- LOST BEFORE 0076',
  $$ seqs() like '%4:04%' $$);
select expect('round 1 keeps its score', $$ (select score_a from matches where id = 'ffffffff-0000-0000-0000-000000000001') = 15 $$);

\echo ''
\echo '=== ...then taps Next Round, drawing ITS OWN round 2 ==='
select t('stale push with a different round 2 (unscored)',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"scored","generation_reason":"x","seed_used":1},
                {"id":"eeeeeeee-0000-0000-0000-0000000000a2","sequence":2,"status":"in_progress","generation_reason":"x","seed_used":2}],
      "matches":[{"id":"ffffffff-0000-0000-0000-0000000000a2","round_id":"eeeeeeee-0000-0000-0000-0000000000a2",
                  "court_id":"cccccccc-0000-0000-0000-000000000001","status":"not_started"}],
      "participants":[]}
     $j$::jsonb) $$);
select expect('the played round 2 stands; the stale one is left out',
  $$ seqs() like '%2:02%' and seqs() not like '%2:a2%'
     and not exists (select 1 from matches where id = 'ffffffff-0000-0000-0000-0000000000a2') $$);
select expect('the device is told which round was skipped',
  $$ sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-0000000000a2","sequence":2,"status":"in_progress","generation_reason":"x","seed_used":2}]}
     $j$::jsonb) -> 'skipped_rounds' = '["eeeeeeee-0000-0000-0000-0000000000a2"]'::jsonb $$);

\echo ''
\echo '=== What the host really does still works ==='
select t('Refresh round 4 (unplayed) under a new id',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-0000000000b4","sequence":4,"status":"in_progress","generation_reason":"x","seed_used":9}],
      "discarded_round_ids":["eeeeeeee-0000-0000-0000-000000000004"]}
     $j$::jsonb) $$);
select expect('round 4 is the new draw', $$ seqs() like '%4:b4%' and seqs() not like '%4:04%' $$);

select t('an app before 1.1 redraws round 4 (no tombstone)',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-0000000000c4","sequence":4,"status":"in_progress","generation_reason":"x","seed_used":10}]}
     $j$::jsonb) $$);
select expect('an unplayed round is still replaced by the same number', $$ seqs() like '%4:c4%' $$);

select t('Delete a PLAYED round by naming it',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "discarded_round_ids":["eeeeeeee-0000-0000-0000-000000000003"]}
     $j$::jsonb) $$);
select expect('a named round goes, even played', $$ seqs() not like '%3:03%' $$);

select t('an old app deletes its current round (silence, no tombstone)',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"scored","generation_reason":"x","seed_used":1},
                {"id":"eeeeeeee-0000-0000-0000-000000000002","sequence":2,"status":"scored","generation_reason":"x","seed_used":2}]}
     $j$::jsonb) $$);
select expect('the known trade-off: it stays, unscored (no rating changes)',
  $$ seqs() like '%4:c4%' and (select count(*) from matches m join rounds r on r.id = m.round_id
                                where r.sequence = 4 and m.status = 'final') = 0 $$);
