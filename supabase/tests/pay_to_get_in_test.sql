-- ---------------------------------------------------------------------
-- pay_to_get_in_test.sql -- proves 0084: Pay to get in.
-- ---------------------------------------------------------------------
\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin@t'), ('b0000000-0000-0000-0000-00000000000b', 'budi@t'),
  ('c0000000-0000-0000-0000-00000000000c', 'citra@t'), ('d0000000-0000-0000-0000-00000000000d', 'dewi@t'),
  ('e0000000-0000-0000-0000-00000000000e', 'eko@t');
insert into profiles (id, display_name) values
  ('a0000000-0000-0000-0000-00000000000a', 'Admin'), ('b0000000-0000-0000-0000-00000000000b', 'Budi'),
  ('c0000000-0000-0000-0000-00000000000c', 'Citra'), ('d0000000-0000-0000-0000-00000000000d', 'Dewi'),
  ('e0000000-0000-0000-0000-00000000000e', 'Eko')
on conflict (id) do update set display_name = excluded.display_name;
insert into clubs (id, name, club_code, created_by) values ('c1000000-0000-0000-0000-000000000001', 'Pler', 'PLR001', 'a0000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'owner'),
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'member');
insert into club_events (id, club_id, title, scheduled_at, status, created_by, max_players) values
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Thursday', now() + interval '2 days', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 4);

create or replace function expect(p_name text, p_sql text) returns void
language plpgsql security definer as $$
declare v bool;
begin
  execute 'select (' || p_sql || ')' into v;
  raise notice '%  %', case when coalesce(v, false) then 'PASS' else 'FAIL' end, rpad(p_name, 70);
end; $$;
create or replace function t(p_name text, p_sql text, p_should_fail bool default false) returns void
language plpgsql as $$
declare v_err text;
begin
  begin execute p_sql; v_err := null; exception when others then v_err := sqlerrm; end;
  raise notice '%  %  %', case when (v_err is null) <> p_should_fail then 'PASS' else 'FAIL' end,
    rpad(p_name, 70), coalesce('-> ' || left(v_err, 55), '');
end; $$;
create or replace function as_user(p uuid) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', p::text, false) $$;
create or replace function resp(p_u uuid) returns text language sql security definer as
  $$ select response from club_event_rsvps where event_id = 'e1000000-0000-0000-0000-000000000001' and user_id = p_u $$;
create or replace function rat(p_u uuid) returns timestamptz language sql security definer as
  $$ select receipt_at from club_event_payments where event_id = 'e1000000-0000-0000-0000-000000000001' and user_id = p_u $$;
create or replace function notes_for(p_u uuid, p_type text) returns int language sql security definer as
  $$ select count(*)::int from notifications where user_id = p_u and type = p_type $$;
grant execute on function expect(text, text), t(text, text, bool), as_user(uuid), resp(uuid), rat(uuid), notes_for(uuid, text) to authenticated;
set client_min_messages = notice;
set role authenticated;

\echo ''
\echo '=== Switching it on ==='
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('admin picks Pay to get in', $$ select set_callup_options('e1000000-0000-0000-0000-000000000001', 'prepay', 'BCA 123') $$);
select t('an unknown option is still refused', $$ select set_callup_options('e1000000-0000-0000-0000-000000000001', 'cash', null) $$, true);

\echo ''
\echo '=== Everyone joins the waiting list ==='
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('Budi answers I''m in', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in') $$);
select expect('...and is waiting, though the night is empty', $$ resp('b0000000-0000-0000-0000-00000000000b') = 'waitlist' $$);
select t('Budi brings Rina', $$ select add_event_guest('e1000000-0000-0000-0000-000000000001', 'Rina', 'F') $$);
select expect('...who waits too', $$ (select response from club_event_guests where display_name = 'Rina') = 'waitlist' $$);
select expect('nobody is in', $$ event_in_count('e1000000-0000-0000-0000-000000000001') = 0 $$);
select expect('Budi can upload', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'upload_open')::boolean $$);

\echo ''
\echo '=== Receipts, in the order they arrive ==='
select t('Budi uploads his own receipt', $$ select upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'aGVsbG8=', 'image/png') $$);
select expect('1 spot being checked (Rina isn''t covered by it)', $$ callup_pending_spots('e1000000-0000-0000-0000-000000000001', null) = 1 $$);
select expect('Budi is first to be checked', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'check_position')::int = 1 $$);
select expect('Rina shows under Budi''s guests, no receipt yet', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'my_guests' -> 0 ->> 'has_receipt')::boolean = false $$);
select pg_sleep(0.05);
select t('Budi uploads Rina''s receipt', $$ select upload_guest_receipt((select id from club_event_guests where display_name = 'Rina'), 'aGVsbG8=', 'image/png') $$);
select expect('Rina is second in line', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'my_guests' -> 0 ->> 'check_position')::int = 2 $$);
select pg_sleep(0.05);
select as_user('c0000000-0000-0000-0000-00000000000c');
select t('Citra cannot upload before answering', $$ select upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'aGVsbG8=', 'image/png') $$, true);
select t('Citra cannot upload for Budi''s guest', $$ select upload_guest_receipt((select id from club_event_guests where display_name = 'Rina'), 'aGVsbG8=', 'image/png') $$, true);
select t('Citra answers and uploads', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in'), upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'aGVsbG8=', 'image/png') $$);
select pg_sleep(0.05);
select as_user('d0000000-0000-0000-0000-00000000000d');
select t('Dewi answers and uploads: 4 of 4 spots now asked for', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in'), upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'aGVsbG8=', 'image/png') $$);
select expect('Dewi is fourth in line', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'check_position')::int = 4 $$);
select expect('upload times keep fractions of a second', $$ rat('d0000000-0000-0000-0000-00000000000d') > rat('c0000000-0000-0000-0000-00000000000c') and rat('c0000000-0000-0000-0000-00000000000c') > rat('b0000000-0000-0000-0000-00000000000b') $$);
select as_user('e0000000-0000-0000-0000-00000000000e');
select t('Eko answers I''m in', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in') $$);
select expect('Eko''s upload button is gone (every spot asked for)', $$ not (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'upload_open')::boolean $$);
select t('...and the server refuses it too', $$ select upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'aGVsbG8=', 'image/png') $$, true);
select as_user('d0000000-0000-0000-0000-00000000000d');
select t('Dewi replaces her receipt', $$ select upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'd29ybGQ=', 'image/png') $$);
select expect('...and keeps her place (same time)', $$ rat('d0000000-0000-0000-0000-00000000000d') > rat('c0000000-0000-0000-0000-00000000000c') and (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'check_position')::int = 4 $$);

\echo ''
\echo '=== The admin checks, first come first ==='
select as_user('a0000000-0000-0000-0000-00000000000a');
select expect('members to check, in upload order', $$ (select array_agg(display_name) from get_callup_payments('e1000000-0000-0000-0000-000000000001')) = array['Budi','Citra','Dewi'] $$);
select expect('Rina has her own row, as Budi''s guest', $$ exists (select 1 from get_callup_guest_payments('e1000000-0000-0000-0000-000000000001')
   where display_name = 'Rina' and invited_by_name = 'Budi' and has_receipt and response = 'waitlist') $$);
select expect('the admin can see Rina''s receipt', $$ get_guest_receipt((select id from club_event_guests where display_name = 'Rina')) ->> 'mime' = 'image/png' $$);
select t('accept Budi', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'paid') $$);
select expect('Budi is in; Rina still waits for her own receipt', $$ resp('b0000000-0000-0000-0000-00000000000b') = 'in' and (select response from club_event_guests where display_name = 'Rina') = 'waitlist' $$);
select t('accept Rina', $$ select set_guest_payment((select id from club_event_guests where display_name = 'Rina'), 'paid') $$);
select expect('Rina is in', $$ (select response from club_event_guests where display_name = 'Rina') = 'in' $$);
select expect('Budi was told twice (himself, then Rina)', $$ notes_for('b0000000-0000-0000-0000-00000000000b', 'event_promoted') = 2 $$);
select t('reject Citra', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'reject', 'Wrong amount') $$);
select expect('Citra still waits', $$ resp('c0000000-0000-0000-0000-00000000000c') = 'waitlist' $$);
select as_user('e0000000-0000-0000-0000-00000000000e');
select expect('a place opened: Eko can upload again', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'upload_open')::boolean $$);
select t('Eko uploads', $$ select upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'aGVsbG8=', 'image/png') $$);
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('accept Dewi and Eko', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'paid'), set_callup_payment('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'paid') $$);
select expect('full: 4 of 4 in', $$ event_in_count('e1000000-0000-0000-0000-000000000001') = 4 $$);
select expect('4 of 4 paid, Rina counted on her own', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'paid_spots')::int = 4 $$);

\echo ''
\echo '=== Leaving ==='
select as_user('e0000000-0000-0000-0000-00000000000e');
select t('Eko drops out', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'out') $$);
select expect('nobody is moved up for free', $$ event_in_count('e1000000-0000-0000-0000-000000000001') = 3 and resp('c0000000-0000-0000-0000-00000000000c') = 'waitlist' $$);
select expect('Citra (waiting, no receipt) is told a spot opened', $$ notes_for('c0000000-0000-0000-0000-00000000000c', 'callup_spot_open') = 1 $$);
select as_user('c0000000-0000-0000-0000-00000000000c');
select t('Citra uploads again', $$ select upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'aGVsbG8=', 'image/png') $$);
select t('...then changes her mind (maybe)', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'maybe') $$);
select expect('her receipt is withdrawn, the spot is free again', $$ callup_pending_spots('e1000000-0000-0000-0000-000000000001', null) = 0 $$);

\echo ''
\echo '=== Other modes unchanged ==='
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('switch to tick only', $$ select set_callup_options('e1000000-0000-0000-0000-000000000001', 'tick', null) $$);
select as_user('c0000000-0000-0000-0000-00000000000c');
select t('Citra answers I''m in', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in') $$);
select expect('...and is straight in (a spot was free)', $$ resp('c0000000-0000-0000-0000-00000000000c') = 'in' $$);
reset role;
