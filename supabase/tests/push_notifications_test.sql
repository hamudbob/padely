-- ---------------------------------------------------------------------
-- push_notifications_test.sql -- proves 0073. pg_net is replaced by a
-- recorder with the same signature, so every HTTP call the database would
-- make to send-push is captured and checked.
-- ---------------------------------------------------------------------

\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

-- A stand-in for pg_net: same signature, records instead of sending.
create schema if not exists net;
create table if not exists net.calls (id bigserial primary key, url text, body jsonb, headers jsonb);
create table if not exists net._http_response (id bigint primary key, status_code int, content text, error_msg text);
create table if not exists net.fail (on_ boolean);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                                         headers jsonb default '{}', timeout_milliseconds integer default 5000)
returns bigint language plpgsql as $$
declare v bigint;
begin
  if exists (select 1 from net.fail where on_) then raise exception 'network is down'; end if;
  insert into net.calls (url, body, headers) values (url, body, headers) returning id into v;
  insert into net._http_response (id, status_code, content) values (v, 200, '{"sent":1}');
  return v;
end; $$;
grant usage on schema net to public;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@test'),
  ('22222222-2222-2222-2222-222222222222', 'ana@test'),
  ('33333333-3333-3333-3333-333333333333', 'budi@test'),
  ('44444444-4444-4444-4444-444444444444', 'rsvp@test'),
  ('55555555-5555-5555-5555-555555555555', 'other@test');
update profiles set display_name = 'Hamud', is_admin = true where id = '11111111-1111-1111-1111-111111111111';
update profiles set display_name = 'Ana'  where id = '22222222-2222-2222-2222-222222222222';
update profiles set display_name = 'Budi' where id = '33333333-3333-3333-3333-333333333333';
insert into teams (id, owner_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'T');
insert into clubs (id, name, club_code) values ('a1000000-0000-0000-0000-000000000001', 'Club', 'CLUB01');
insert into club_members (club_id, user_id, role) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('a1000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member'),
  ('a1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'member'),
  ('a1000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'member'),
  ('a1000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'member')
  on conflict do nothing;

insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis,
                      status, join_code, public_token, scheduling_seed, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000001', 'Kamis Malam', 'mexicano', 'fixed_21', 'points_first',
        'draft', '424242', 'tok-push', 1, '11111111-1111-1111-1111-111111111111');
insert into club_events (id, club_id, title, scheduled_at, location, session_id, created_by) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Kamis Malam',
   now() + interval '3 hours', 'Kemang', 'bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Sabtu Pagi',
   now() + interval '62 minutes', 'Senayan', null, '11111111-1111-1111-1111-111111111111');
insert into club_event_rsvps (event_id, user_id, response) values
  ('e1000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'in'),
  ('e1000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'in'),
  ('e1000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'maybe');

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
create or replace function refused(p_name text, p_sql text) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null; exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when v_err is not null then 'PASS' else 'FAIL' end, rpad(p_name, 66), coalesce('-> ' || left(v_err, 60), '(was allowed)');
end; $$;
create or replace function n_count(p_type text) returns int language sql security definer as
  $$ select count(*)::int from notifications where type = p_type $$;
create or replace function last_call() returns jsonb language sql security definer as
  $$ select body from net.calls order by id desc limit 1 $$;
create or replace function calls() returns int language sql security definer as
  $$ select count(*)::int from net.calls $$;
create or replace function as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false)::text is not null; $$;
grant execute on function expect(text, text), t(text, text), refused(text, text), n_count(text),
  last_call(), calls(), as_user(uuid) to authenticated;

set client_min_messages = notice;

\echo ''
\echo '=== Not configured yet: in-app only, nothing sent ==='
insert into join_requests (session_id, display_name) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Cici');
select expect('the host gets an in-app join request', $$ n_count('session_join_request') = 1 $$);
select expect('no HTTP call without push_config', $$ calls() = 0 $$);

insert into push_config (function_url, secret, anon_key)
values ('https://example.supabase.co/functions/v1/send-push', 's3cret', 'anon-jwt');

\echo ''
\echo '=== 1. Join request and claim -> the host ==='
insert into join_requests (session_id, display_name) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Dodi');
select expect('one push, to the host only',
  $$ calls() = 1 and last_call() -> 'userIds' = '["11111111-1111-1111-1111-111111111111"]'::jsonb $$);
select expect('"Dodi wants to join", tapping opens the host screen',
  $$ last_call() ->> 'title' = 'Dodi wants to join'
     and last_call() ->> 'path' = '/session/bbbbbbbb-0000-0000-0000-000000000001/host' $$);
select expect('the secret and the anon key travel as headers',
  $$ (select headers ->> 'x-push-secret' = 's3cret' and headers ->> 'Authorization' = 'Bearer anon-jwt'
        from net.calls order by id desc limit 1) $$);

insert into players (id, session_id, display_name, status) values
  ('d0000000-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000001', 'Typed In', 'active');
insert into player_claims (session_id, player_id, claimant_user_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000009', '33333333-3333-3333-3333-333333333333');
select expect('a claim pushes "Budi is claiming a spot" to the host',
  $$ last_call() ->> 'title' = 'Budi is claiming a spot'
     and last_call() -> 'userIds' = '["11111111-1111-1111-1111-111111111111"]'::jsonb $$);

\echo ''
\echo '=== 2. Live -> the players with accounts, and whoever RSVPd in ==='
insert into players (id, session_id, display_name, status, linked_user_id) values
  ('d0000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Hamud', 'active', '11111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Ana',   'active', '22222222-2222-2222-2222-222222222222'),
  ('d0000000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'Budi',  'active', '33333333-3333-3333-3333-333333333333');
select t('host starts the session', $$ update sessions set status = 'live', started_at = now() where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$);
select expect('three told: Ana, Budi, and the RSVP — never the host',
  $$ n_count('session_live') = 3
     and not exists (select 1 from notifications where type = 'session_live' and user_id = '11111111-1111-1111-1111-111111111111')
     and exists (select 1 from notifications where type = 'session_live' and user_id = '44444444-4444-4444-4444-444444444444') $$);
select expect('...in ONE request carrying all three',
  $$ jsonb_array_length(last_call() -> 'userIds') = 3 and last_call() ->> 'path' = '/live/tok-push' $$);
select expect('the club member who is not playing is not told',
  $$ not exists (select 1 from notifications where type = 'session_live' and user_id = '55555555-5555-5555-5555-555555555555') $$);
select t('another push while live', $$ update sessions set status = 'live' where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$);
select expect('no second "live" message', $$ n_count('session_live') = 3 $$);

\echo ''
\echo '=== +. Made co-host -> the co-host ==='
set role authenticated;
select as_user('11111111-1111-1111-1111-111111111111');
select t('host adds Ana as co-host',
  $$ insert into session_scorers (session_id, user_id, added_by)
     values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111') $$);
reset role;
select expect('Ana is told, and the tap opens her co-host screen',
  $$ last_call() -> 'userIds' = '["22222222-2222-2222-2222-222222222222"]'::jsonb
     and last_call() ->> 'path' = '/session/bbbbbbbb-0000-0000-0000-000000000001/score' $$);

\echo ''
\echo '=== 5. Final standings -> the same players, once ==='
insert into courts (id, session_id, ordinal, display_name) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'Court 1');
insert into rounds (id, session_id, sequence, status, generation_reason, seed_used) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 1, 'scored', 'x', 1);
insert into matches (id, round_id, court_id, status, score_a, score_b, outcome) values
  ('ffffffff-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'final', 15, 6, 'win_a');
select t('the session ends', $$ update sessions set status = 'ended', ended_at = now() where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$);
select expect('"Final standings" to the three, opening the podium',
  $$ n_count('session_final') = 3 and last_call() ->> 'path' = '/session/bbbbbbbb-0000-0000-0000-000000000001/final' $$);
set role authenticated;
select as_user('11111111-1111-1111-1111-111111111111');
select t('reopened', $$ select reopen_session('bbbbbbbb-0000-0000-0000-000000000001') $$);
reset role;
select t('and ended again', $$ update sessions set status = 'ended', ended_at = now() where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$);
select expect('no second "live", no second "final"', $$ n_count('session_live') = 3 and n_count('session_final') = 3 $$);

\echo ''
\echo '=== 3. An hour before -> who said "in" ==='
select expect('one event is due', $$ send_event_reminders() = 1 $$);
select expect('Ana (in) is reminded; Budi (maybe) is not',
  $$ exists (select 1 from notifications where type = 'event_reminder' and user_id = '22222222-2222-2222-2222-222222222222')
     and not exists (select 1 from notifications where type = 'event_reminder' and user_id = '33333333-3333-3333-3333-333333333333') $$);
select expect('the time is Jakarta time',
  $$ (select body from notifications where type = 'event_reminder' limit 1)
     like to_char((now() + interval '62 minutes') at time zone 'Asia/Jakarta', 'HH24') || ':%' $$);
select expect('and only once', $$ send_event_reminders() = 0 $$);

\echo ''
\echo '=== Testing from a phone ==='
set role authenticated;
select as_user('33333333-3333-3333-3333-333333333333');
select t('Budi sends himself a test', $$ select send_test_push() $$);
select refused('a second within the minute is refused', $$ select send_test_push() $$);
select refused('Budi cannot read the admin status', $$ select admin_push_status() $$);
select as_user('11111111-1111-1111-1111-111111111111');
select expect('the admin can, and sees 200s from send-push',
  $$ (admin_push_status() ->> 'configured')::boolean
     and (admin_push_status() -> 'log' -> 0 ->> 'status_code') = '200' $$);
reset role;
select expect('the test push went to Budi only', $$ last_call() -> 'userIds' = '["33333333-3333-3333-3333-333333333333"]'::jsonb $$);

\echo ''
\echo '=== A broken push never breaks the thing that caused it ==='
insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis,
                      status, join_code, public_token, scheduling_seed, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'Jumat', 'mexicano',
        'fixed_21', 'points_first', 'draft', '434343', 'tok-2', 1, '11111111-1111-1111-1111-111111111111');
insert into net.fail values (true);
select expect('an ended session takes no join-request pings',
  $$ n_count('session_join_request') = 2 $$);
select t('a join request while the network is down',
  $$ insert into join_requests (session_id, display_name) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Eka') $$);
select expect('the request and its in-app notification still exist',
  $$ exists (select 1 from join_requests where display_name = 'Eka') and n_count('session_join_request') = 3 $$);
select expect('and the failure is logged', $$ exists (select 1 from push_log where error like '%network is down%') $$);
delete from net.fail;

update push_config set muted_types = '{session_join_request}';
select t('a muted type', $$ insert into join_requests (session_id, display_name) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Fajar') $$);
select expect('is written in-app but not pushed',
  $$ n_count('session_join_request') = 4 and last_call() ->> 'title' <> 'Fajar wants to join' $$);

set role authenticated;
select as_user('22222222-2222-2222-2222-222222222222');
select refused('nobody can read the push secret', $$ select secret from push_config $$);
select refused('nobody can run the reminder job', $$ select send_event_reminders() $$);
