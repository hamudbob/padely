\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test'),
  ('22222222-2222-2222-2222-222222222222', 'member@test'),
  ('33333333-3333-3333-3333-333333333333', 'outsider@test');
insert into profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111','Host'),
  ('22222222-2222-2222-2222-222222222222','Member'),
  ('33333333-3333-3333-3333-333333333333','Outsider')
on conflict (id) do nothing;
insert into teams (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Host Team');
insert into clubs (id, name, created_by, club_code) values
  ('cbcbcbcb-0000-0000-0000-000000000001', 'Real Club', '11111111-1111-1111-1111-111111111111', 'AAA111');
insert into club_members (club_id, user_id, role) values
  ('cbcbcbcb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','owner'),
  ('cbcbcbcb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','member');
insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis, status, join_code, public_token, scheduling_seed, created_by) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','cbcbcbcb-0000-0000-0000-000000000001',
   'Tuesday','mexicano','fixed_21','points_first','live','123456','tok-live',1,'11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',null,
   'Private','mexicano','fixed_21','points_first','live','654321','tok-private',1,'11111111-1111-1111-1111-111111111111');
insert into club_events (id, club_id, title, scheduled_at, session_id, created_by) values
  ('eeeeeeee-0000-0000-0000-000000000001','cbcbcbcb-0000-0000-0000-000000000001','Tuesday Night', now(),
   'bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111');

-- SECURITY INVOKER on purpose: a definer helper runs as its owner, which
-- bypasses RLS and would make "the member cannot see it" pass for the
-- wrong reason. Every check below runs with the caller's own rights.
create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security invoker as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, p_name;
end; $$;

set client_min_messages = notice;
set role authenticated;

\echo '=== The bug: a member reading the table directly sees nothing ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select expect('member: direct sessions read returns 0 rows (this is what the club card did)',
  $$ (select count(*) from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0 $$);

\echo '=== The fix ==='
select expect('member: sees the live session through the RPC',
  $$ (select status from get_club_event_sessions(array['bbbbbbbb-0000-0000-0000-000000000001'::uuid])) = 'live' $$);
select expect('member: gets the token and code the Join button needs',
  $$ (select public_token = 'tok-live' and join_code = '123456'
        from get_club_event_sessions(array['bbbbbbbb-0000-0000-0000-000000000001'::uuid])) $$);
select expect('member: a session no club event points at stays invisible',
  $$ (select count(*) from get_club_event_sessions(array['bbbbbbbb-0000-0000-0000-000000000002'::uuid])) = 0 $$);

\echo '=== Scope ==='
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select expect('outsider (not in the club): sees nothing',
  $$ (select count(*) from get_club_event_sessions(array['bbbbbbbb-0000-0000-0000-000000000001'::uuid])) = 0 $$);
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select expect('host: still sees it',
  $$ (select status from get_club_event_sessions(array['bbbbbbbb-0000-0000-0000-000000000001'::uuid])) = 'live' $$);
reset role;
select expect('anon cannot call it',
  $$ not has_function_privilege('anon', 'get_club_event_sessions(uuid[])', 'execute') $$);
