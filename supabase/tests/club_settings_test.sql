-- ---------------------------------------------------------------------
-- club_settings_test.sql -- proves 0079: club settings and seasons.
-- ---------------------------------------------------------------------
\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test'),
  ('22222222-2222-2222-2222-222222222222', 'member@test'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@test');
insert into profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner'),
  ('22222222-2222-2222-2222-222222222222', 'Member'),
  ('33333333-3333-3333-3333-333333333333', 'Stranger')
on conflict (id) do nothing;
insert into clubs (id, name, club_code, created_by)
  values ('c1c1c1c1-0000-0000-0000-000000000001', 'Kemang', 'KEMANG', '11111111-1111-1111-1111-111111111111');
insert into club_members (club_id, user_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('c1c1c1c1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'member');

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 66);
end; $$;
create or replace function t(p_name text, p_sql text, p_should_fail bool default false) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null; exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %',
    case when (v_err is null) <> p_should_fail then 'PASS' else 'FAIL' end,
    rpad(p_name, 66), coalesce('-> ' || left(v_err, 60), '');
end; $$;
create or replace function as_user(p uuid) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', p::text, false) $$;
grant execute on function expect(text, text), t(text, text, bool), as_user(uuid) to authenticated;
set client_min_messages = notice;

\echo ''
\echo '=== Seasons ==='
select expect('a new club gets its first season rule (1 Jan 2000, monthly)',
  $$ (select count(*) from club_season_rules where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
        and starts_at = '2000-01-01T00:00:00Z' and length = 'monthly') = 1 $$);

set role authenticated;
select as_user('22222222-2222-2222-2222-222222222222');
select t('a member cannot change settings',
  $$ select update_club_settings('c1c1c1c1-0000-0000-0000-000000000001', '{"join_mode":"open"}') $$, true);

select as_user('11111111-1111-1111-1111-111111111111');
select t('the owner schedules 3-month seasons from next month',
  format($$ select update_club_settings('c1c1c1c1-0000-0000-0000-000000000001', %L::jsonb) $$,
    jsonb_build_object('season_length', '3_month',
                       'season_starts_at', date_trunc('month', now() at time zone 'UTC' + interval '1 month') at time zone 'UTC')));
select expect('the change is stored, starting next month',
  $$ (select length from club_season_rules where club_id = 'c1c1c1c1-0000-0000-0000-000000000001' and starts_at > now()) = '3_month' $$);
select expect('this season keeps its length (league_period still monthly)',
  $$ (select league_period from clubs where id = 'c1c1c1c1-0000-0000-0000-000000000001') = 'monthly' $$);
select t('a change cannot start in the past',
  $$ select update_club_settings('c1c1c1c1-0000-0000-0000-000000000001', '{"season_length":"yearly","season_starts_at":"2020-01-01T00:00:00Z"}') $$, true);
select t('changing back to monthly before it starts',
  format($$ select update_club_settings('c1c1c1c1-0000-0000-0000-000000000001', %L::jsonb) $$,
    jsonb_build_object('season_length', 'monthly',
                       'season_starts_at', date_trunc('month', now() at time zone 'UTC' + interval '1 month') at time zone 'UTC')));
select expect('cancels the planned change', $$ not exists (select 1 from club_season_rules
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001' and starts_at > now()) $$);

\echo ''
\echo '=== Membership ==='
select as_user('33333333-3333-3333-3333-333333333333');
select t('club code, approval mode: a request',
  $$ select join_club_by_code('kemang') $$);
select expect('stranger is not a member yet, request pending',
  $$ not exists (select 1 from club_members where user_id = '33333333-3333-3333-3333-333333333333')
     and exists (select 1 from club_join_requests where user_id = '33333333-3333-3333-3333-333333333333' and status = 'pending') $$);
reset role;
delete from club_join_requests where user_id = '33333333-3333-3333-3333-333333333333';
set role authenticated;
select as_user('11111111-1111-1111-1111-111111111111');
select t('owner opens the club code and hides the club from search',
  $$ select update_club_settings('c1c1c1c1-0000-0000-0000-000000000001', '{"join_mode":"open","listed":false}') $$);
select as_user('33333333-3333-3333-3333-333333333333');
select expect('hidden from a stranger''s search', $$ not exists (select 1 from search_clubs('Kem')) $$);
select expect('code joins straight away',
  $$ (join_club_by_code('KEMANG') ->> 'joined')::boolean $$);
select expect('now a member, and sees the club in search',
  $$ exists (select 1 from search_clubs('Kem')) $$);
reset role;
select expect('the owner is told', $$ exists (select 1 from notifications
  where user_id = '11111111-1111-1111-1111-111111111111' and type = 'club_joined') $$);

\echo ''
\echo '=== Guests and the waiting list ==='
insert into club_events (id, club_id, title, scheduled_at, status, created_by, max_players, slug)
  values ('e1e1e1e1-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'Tue',
          now() + interval '3 days', 'scheduled', '11111111-1111-1111-1111-111111111111', 2, 'tue-test');
set role authenticated;
select as_user('11111111-1111-1111-1111-111111111111');
select t('owner: 1 guest each, no waiting list',
  $$ select update_club_settings('c1c1c1c1-0000-0000-0000-000000000001', '{"max_guests":1,"waitlist_enabled":false}') $$);
select t('owner is in', $$ select set_event_rsvp('e1e1e1e1-0000-0000-0000-000000000001', 'in') $$);
select t('owner brings one guest (2 of 2)', $$ select add_event_guest('e1e1e1e1-0000-0000-0000-000000000001', 'Rizky') $$);
select t('a second guest is refused', $$ select add_event_guest('e1e1e1e1-0000-0000-0000-000000000001', 'Dewi') $$, true);
select as_user('22222222-2222-2222-2222-222222222222');
select t('full, no waiting list: member is told it is full',
  $$ select set_event_rsvp('e1e1e1e1-0000-0000-0000-000000000001', 'in') $$, true);
select as_user('11111111-1111-1111-1111-111111111111');
select t('waiting list back on', $$ select update_club_settings('c1c1c1c1-0000-0000-0000-000000000001', '{"waitlist_enabled":true}') $$);
select as_user('22222222-2222-2222-2222-222222222222');
select expect('full: member goes on the waiting list',
  $$ (set_event_rsvp('e1e1e1e1-0000-0000-0000-000000000001', 'in') ->> 'response') = 'waitlist' $$);

\echo ''
\echo '=== Reminders ==='
reset role;
update club_events set scheduled_at = now() + interval '2 hours' where id = 'e1e1e1e1-0000-0000-0000-000000000001';
select expect('default (1 hour): not yet, 2 hours out', $$ send_event_reminders() = 0 $$);
update clubs set reminder_minutes = 120 where id = 'c1c1c1c1-0000-0000-0000-000000000001';
select expect('2 hours: sent', $$ send_event_reminders() = 1 $$);
select expect('and it says 2 hours', $$ exists (select 1 from notifications where type = 'event_reminder' and title like '%starts in 2 hours') $$);
update clubs set reminder_minutes = 0 where id = 'c1c1c1c1-0000-0000-0000-000000000001';
update club_events set reminder_sent_at = null where id = 'e1e1e1e1-0000-0000-0000-000000000001';
select expect('off: nothing sent', $$ send_event_reminders() = 0 $$);

\echo ''
\echo '=== Defaults and the minimum ==='
set role authenticated;
select as_user('11111111-1111-1111-1111-111111111111');
select t('owner saves Call-up and session defaults, minimum 3 nights',
  $$ select update_club_settings('c1c1c1c1-0000-0000-0000-000000000001',
       '{"league_min_sessions":3,"callup_defaults":{"weekday":2,"time":"19:30"},"session_defaults":{"format":"mexicano","courts":2}}') $$);
reset role;
select expect('stored', $$ (select league_min_sessions = 3 and callup_defaults ->> 'time' = '19:30' and session_defaults ->> 'format' = 'mexicano'
   from clubs where id = 'c1c1c1c1-0000-0000-0000-000000000001') $$);
