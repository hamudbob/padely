-- ---------------------------------------------------------------------
-- session_date_test.sql -- proves 0083: a night is dated by its start.
-- ---------------------------------------------------------------------
\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-00000000000a', 'host@t'), ('b0000000-0000-0000-0000-00000000000b', 'budi@t');
insert into profiles (id, display_name) values ('a0000000-0000-0000-0000-00000000000a', 'Host'), ('b0000000-0000-0000-0000-00000000000b', 'Budi')
on conflict (id) do update set display_name = excluded.display_name;
insert into teams (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Host');
insert into clubs (id, name, club_code, created_by) values ('c1000000-0000-0000-0000-000000000001', 'Pler', 'PLR001', 'a0000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'owner'),
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'member');
-- Monday 2 Nov 21:13 Jakarta, ended Tuesday 01:09. And an old night,
-- 31 Oct 22:00 to 1 Nov 00:30, already in the league with the end date.
insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis, status, join_code, public_token, scheduling_seed, created_by, started_at, ended_at) values
  ('5e000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Monday', 'mexicano', 'fixed_21', 'points_first', 'ended', '111111', 'tok-1', 1, 'a0000000-0000-0000-0000-00000000000a',
   '2026-11-02 21:13+07', '2026-11-03 01:09+07'),
  ('5e000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Halloween', 'mexicano', 'fixed_21', 'points_first', 'ended', '222222', 'tok-2', 1, 'a0000000-0000-0000-0000-00000000000a',
   '2026-10-31 22:00+07', '2026-11-01 00:30+07');
insert into session_results (session_id, club_id, user_id, session_date, rank, field_size, player_count, placement_points) values
  ('5e000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', '2026-11-01 00:30+07', 1, 8, 8, 8);
update sessions set results_applied = true where id = '5e000000-0000-0000-0000-000000000002';

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 70);
end; $$;
create or replace function as_user(p uuid) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', p::text, false) $$;
grant execute on function expect(text, text), as_user(uuid) to authenticated;
set client_min_messages = notice;

\echo ''
\echo '=== Re-dating what is already in the league ==='
select expect('before: Halloween counts as 1 Nov', $$ (select (session_date at time zone 'Asia/Jakarta')::date from session_results where session_id = '5e000000-0000-0000-0000-000000000002') = '2026-11-01' $$);
set client_min_messages = warning;
\i supabase/migrations/0083_session_date_is_start.sql
set client_min_messages = notice;
select expect('after: Halloween counts as 31 Oct, the night it was played', $$ (select (session_date at time zone 'Asia/Jakarta')::date from session_results where session_id = '5e000000-0000-0000-0000-000000000002') = '2026-10-31' $$);

\echo ''
\echo '=== A new night is dated by its start ==='
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
select apply_session_results('5e000000-0000-0000-0000-000000000001',
  '[{"user_id":"b0000000-0000-0000-0000-00000000000b","rank":1,"field_size":12,"player_count":12,"placement_points":12,"podium_bonus":3}]'::jsonb);
select expect('Monday counts as Mon 2 Nov, not Tue 3 Nov', $$ (select (session_date at time zone 'Asia/Jakarta')::date from session_results where session_id = '5e000000-0000-0000-0000-000000000001') = '2026-11-02' $$);
select expect('Champions shows 2 Nov too', $$ (select (((x ->> 'session_date')::timestamptz) at time zone 'Asia/Jakarta')::date = '2026-11-02'
  from jsonb_array_elements(get_club_champions('c1000000-0000-0000-0000-000000000001') -> 'recent') x where x ->> 'session_name' = 'Monday') $$);
reset role;
