\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','host@test'),
  ('99999999-9999-9999-9999-999999999999','admin@test');
insert into profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111','Host'),('99999999-9999-9999-9999-999999999999','Admin') on conflict (id) do nothing;
update profiles set is_admin = true where id = '99999999-9999-9999-9999-999999999999';
insert into teams (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','T');
insert into clubs (id, name, created_by, club_code) values ('cbcbcbcb-0000-0000-0000-000000000001','C','11111111-1111-1111-1111-111111111111','AAA111');
insert into club_members (club_id, user_id, role) values ('cbcbcbcb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','owner');
insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis, status, join_code, public_token, scheduling_seed, created_by, results_applied, ratings_applied) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','cbcbcbcb-0000-0000-0000-000000000001','Ended','mexicano','fixed_21','points_first','ended','111111','t1',1,'11111111-1111-1111-1111-111111111111', true, true),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','cbcbcbcb-0000-0000-0000-000000000001','Live','mexicano','fixed_21','points_first','live','222222','t2',1,'11111111-1111-1111-1111-111111111111', false, false);
insert into session_results (session_id, club_id, user_id, session_date, rank, field_size, player_count, placement_points)
values ('bbbbbbbb-0000-0000-0000-000000000001','cbcbcbcb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111', now(), 1, 12, 12, 12);

create or replace function t(p_name text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null; exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when (p_expect = 'allow') = (v_err is null) then 'PASS' else 'FAIL' end, rpad(p_name, 60), coalesce('-> ' || v_err, '');
end; $$;
create or replace function expect(p_name text, p_sql text) returns void language plpgsql security invoker as $$
declare v bool; begin execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v,false) then 'PASS' else 'FAIL' end, p_name; end; $$;

set client_min_messages = notice;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false, false);
select t('the host (not an admin) is refused',
  $$ select admin_reset_session_results('bbbbbbbb-0000-0000-0000-000000000001') $$, 'deny');

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
select t('an admin cannot reset a LIVE session',
  $$ select admin_reset_session_results('bbbbbbbb-0000-0000-0000-000000000002') $$, 'deny');
select t('an admin resets an ended session',
  $$ select admin_reset_session_results('bbbbbbbb-0000-0000-0000-000000000001') $$, 'allow');
reset role;
select expect('its league rows are gone',
  $$ (select count(*) from session_results where session_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0 $$);
select expect('the latch is cleared, so apply_session_results will run again',
  $$ (select not results_applied from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') $$);
select expect('ratings_applied is left alone',
  $$ (select ratings_applied from sessions where id = 'bbbbbbbb-0000-0000-0000-000000000001') $$);
select expect('it is logged',
  $$ exists (select 1 from admin_actions where action = 'reset_session_results') $$);
select expect('anon cannot call it',
  $$ not has_function_privilege('anon', 'admin_reset_session_results(uuid)', 'execute') $$);
