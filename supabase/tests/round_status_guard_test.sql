-- ---------------------------------------------------------------------
-- round_status_guard_test.sql -- proves 0078: a played round stays played,
-- and a posted Call-up says so, in Jakarta time.
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
\echo '=== A phone that is behind still has round 1 as unplayed ==='
select t('stale push: round 1 "in_progress", matches not started',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000001","sequence":1,"status":"in_progress","generation_reason":"x","seed_used":1}],
      "matches":[{"id":"ffffffff-0000-0000-0000-000000000001","round_id":"eeeeeeee-0000-0000-0000-000000000001",
                  "court_id":"cccccccc-0000-0000-0000-000000000001","status":"not_started"}]}
     $j$::jsonb) $$);
select expect('round 1 is still scored                    <-- RESET BEFORE 0078',
  $$ (select status from rounds where id = 'eeeeeeee-0000-0000-0000-000000000001') = 'scored' $$);
select expect('and keeps its score', $$ (select score_a from matches where id = 'ffffffff-0000-0000-0000-000000000001') = 15 $$);

\echo ''
\echo '=== What the host does still works ==='
select t('the current round goes from in_progress to scored',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000004","sequence":4,"status":"scored","generation_reason":"x","seed_used":4}]}
     $j$::jsonb) $$);
select expect('round 4 scored', $$ (select status from rounds where id = 'eeeeeeee-0000-0000-0000-000000000004') = 'scored' $$);

select t('host deletes round 4; round 3 is the latest again and may reopen',
  $$ select sync_session_state($j$
     {"session":{"id":"bbbbbbbb-0000-0000-0000-000000000001","status":"live"},
      "rounds":[{"id":"eeeeeeee-0000-0000-0000-000000000003","sequence":3,"status":"in_progress","generation_reason":"x","seed_used":3}],
      "discarded_round_ids":["eeeeeeee-0000-0000-0000-000000000004"]}
     $j$::jsonb) $$);
select expect('round 4 gone, round 3 back in progress',
  $$ not exists (select 1 from rounds where id = 'eeeeeeee-0000-0000-0000-000000000004')
     and (select status from rounds where id = 'eeeeeeee-0000-0000-0000-000000000003') = 'in_progress' $$);

select expect('round 2, played and earlier, is untouched',
  $$ (select status from rounds where id = 'eeeeeeee-0000-0000-0000-000000000002') = 'scored' $$);

\echo ''
\echo '=== Call-up ==='
reset role;
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'member@test');
insert into clubs (id, name, club_code, created_by)
  values ('c1c1c1c1-0000-0000-0000-000000000001', 'Club', 'CLUB01', '11111111-1111-1111-1111-111111111111');
insert into club_members (club_id, user_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('c1c1c1c1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member');
set role authenticated;
select t('the owner posts a Call-up for Thu 20:00 Jakarta',
  $$ select create_club_event('c1c1c1c1-0000-0000-0000-000000000001', 'Thursday Night',
                               '2026-11-12 13:00:00+00') $$);
reset role;
select expect('the member is told "New Call-up"',
  $$ (select title from notifications where user_id = '22222222-2222-2222-2222-222222222222' and type = 'session_scheduled') = 'New Call-up' $$);
select expect('at 20:00, Jakarta time                     <-- 13:00 BEFORE 0078',
  $$ (select body from notifications where user_id = '22222222-2222-2222-2222-222222222222' and type = 'session_scheduled') = 'Thursday Night · Thu 12 Nov 20:00' $$);
