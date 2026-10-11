\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','host@test'),('22222222-2222-2222-2222-222222222222','rafid@test');
insert into profiles (id, display_name, avatar_url) values
  ('11111111-1111-1111-1111-111111111111','Host',null),
  ('22222222-2222-2222-2222-222222222222','Rafid','https://x.supabase.co/a/rafid.jpg')
on conflict (id) do update set avatar_url = excluded.avatar_url;
insert into teams (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','T');
insert into sessions (id, team_id, name, format, scoring_format, ranking_basis, status, join_code, public_token, scheduling_seed, created_by) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Tuesday','mexicano','fixed_21','points_first','live','123456','tok-1',1,'11111111-1111-1111-1111-111111111111');
insert into players (id, session_id, display_name, linked_user_id) values
  ('dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Rafid','22222222-2222-2222-2222-222222222222'),
  ('dddddddd-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001','Zidane',null);

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security invoker as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, p_name;
end; $$;

set client_min_messages = notice;
set role anon;
\echo '=== spectator link (anon, by token) ==='
select expect('linked player: face and linked=true',
  $$ (select (p->>'avatar_url') = 'https://x.supabase.co/a/rafid.jpg' and (p->>'linked')::boolean
        from jsonb_array_elements(get_public_session('tok-1')->'players') p where p->>'display_name' = 'Rafid') $$);
select expect('unclaimed spot: no face and linked=false',
  $$ (select (p->>'avatar_url') is null and not (p->>'linked')::boolean
        from jsonb_array_elements(get_public_session('tok-1')->'players') p where p->>'display_name' = 'Zidane') $$);
select expect('never leaks the account id',
  $$ not (get_public_session('tok-1')::text like '%22222222-2222-2222-2222-222222222222%') $$);
select expect('the rest of the payload is unchanged (courts, rounds, matches keys present)',
  $$ get_public_session('tok-1') ?& array['session','courts','players','rounds','adjustments','pairs','matches'] $$);
\echo '=== podium page (by id) ==='
select expect('by id: linked flag present too',
  $$ (select (p->>'linked')::boolean from jsonb_array_elements(get_public_session_by_id('bbbbbbbb-0000-0000-0000-000000000001')->'players') p
        where p->>'display_name' = 'Rafid') $$);
reset role;
\echo '=== hardening kept ==='
select expect('get_public_session still pins search_path',
  $$ (select proconfig::text like '%search_path=public%' from pg_proc where proname = 'get_public_session') $$);
select expect('anon can still call it',
  $$ has_function_privilege('anon', 'get_public_session(text)', 'execute') $$);
