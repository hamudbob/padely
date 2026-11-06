-- ---------------------------------------------------------------------
-- callup_payments_test.sql -- proves 0080: paying for a Call-up.
-- ---------------------------------------------------------------------
\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin@t'),
  ('b0000000-0000-0000-0000-00000000000b', 'budi@t'),
  ('c0000000-0000-0000-0000-00000000000c', 'citra@t'),
  ('d0000000-0000-0000-0000-00000000000d', 'dewi@t'),
  ('e0000000-0000-0000-0000-00000000000e', 'eko@t'),
  ('f0000000-0000-0000-0000-00000000000f', 'stranger@t');
insert into profiles (id, display_name) values
  ('a0000000-0000-0000-0000-00000000000a', 'Admin'), ('b0000000-0000-0000-0000-00000000000b', 'Budi'),
  ('c0000000-0000-0000-0000-00000000000c', 'Citra'), ('d0000000-0000-0000-0000-00000000000d', 'Dewi'),
  ('e0000000-0000-0000-0000-00000000000e', 'Eko'), ('f0000000-0000-0000-0000-00000000000f', 'Stranger')
on conflict (id) do update set display_name = excluded.display_name;
insert into clubs (id, name, club_code, created_by) values
  ('c1000000-0000-0000-0000-000000000001', 'Kemang', 'KEM001', 'a0000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'owner'),
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'member');

-- Night 1: tick only. Night 2: receipts, 3 places, starts in 5 hours (past the
-- 6-hour deadline). Night 3: receipts, starts in 50 minutes (frozen).
insert into club_events (id, club_id, title, scheduled_at, status, created_by, max_players, slug, payment_mode, notes) values
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Tick night', now() + interval '3 days', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 8, 'tick-n', 'tick', 'BCA 123 a/n Admin'),
  ('e2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Receipt night', now() + interval '5 hours', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 3, 'rec-n', 'receipt', 'Transfer 120k to BCA 123'),
  ('e3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'Frozen night', now() + interval '50 minutes', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 2, 'frz-n', 'receipt', null);
insert into club_event_rsvps (event_id, user_id, response, responded_at) values
  ('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'in', now() - interval '3 days'),
  ('e2000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c', 'in', now() - interval '3 days'),
  ('e2000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000d', 'in', now() - interval '2 days'),
  ('e2000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000e', 'waitlist', now() - interval '1 day'),
  ('e3000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'in', now() - interval '1 day');
-- Dewi brought a guest who is waiting (3 places, all taken).
insert into club_event_guests (id, event_id, display_name, invited_by, response, created_at) values
  ('90000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002', 'Dewi''s friend', 'd0000000-0000-0000-0000-00000000000d', 'waitlist', now() - interval '20 hours');
-- These answers were given days ago, before the deadline: no pay window was
-- running for them. (Inserting them now, past the deadline, opened one.)
delete from club_event_payments;
delete from notifications;

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
create or replace function resp(p_ev uuid, p_u uuid) returns text language sql security definer as
  $$ select response from club_event_rsvps where event_id = p_ev and user_id = p_u $$;
grant execute on function expect(text, text), t(text, text, bool), as_user(uuid), resp(uuid, uuid) to authenticated;
set client_min_messages = notice;

\echo ''
\echo '=== The night pause ==='
select expect('20:00 → 21:00', $$ pay_window_end('2026-11-10 13:00+00') = '2026-11-10 14:00+00' $$);
select expect('21:30 → 07:30 next morning', $$ pay_window_end('2026-11-10 14:30+00') = '2026-11-11 00:30+00' $$);
select expect('23:00 → 08:00', $$ pay_window_end('2026-11-10 16:00+00') = '2026-11-11 01:00+00' $$);
select expect('06:30 → 08:00', $$ pay_window_end('2026-11-10 23:30+00') = '2026-11-11 01:00+00' $$);

\echo ''
\echo '=== Who can see what ==='
set role authenticated;
select as_user('f0000000-0000-0000-0000-00000000000f');
select expect('a stranger sees no notes', $$ (get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'member')::boolean = false
   and get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'notes' is null $$);
select as_user('b0000000-0000-0000-0000-00000000000b');
select expect('a member sees the notes and "0 of 3 paid"',
  $$ get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'notes' = 'Transfer 120k to BCA 123'
     and (get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'in_spots')::int = 3
     and (get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'paid_spots')::int = 0 $$);
select t('a member cannot list payments', $$ select * from get_callup_payments('e2000000-0000-0000-0000-000000000002') $$, true);
select t('a member cannot mark payments', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'paid') $$, true);
select t('cannot read the receipts table directly', $$ select * from club_event_receipts $$, true);

\echo ''
\echo '=== Tick only: bookkeeping ==='
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('admin ticks Budi paid', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'paid') $$);
select as_user('b0000000-0000-0000-0000-00000000000b');
select expect('Budi sees himself paid', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'me' ->> 'paid')::boolean $$);
select t('no uploads on a Tick night', $$ select upload_callup_receipt('e1000000-0000-0000-0000-000000000001', encode('x'::bytea, 'base64'), 'image/jpeg') $$, true);

\echo ''
\echo '=== Receipts ==='
select t('Budi (in) uploads a receipt', $$ select upload_callup_receipt('e2000000-0000-0000-0000-000000000002', encode('jpegbytes'::bytea, 'base64'), 'image/jpeg') $$);
select as_user('e0000000-0000-0000-0000-00000000000e');
select t('Eko (waiting) cannot upload', $$ select upload_callup_receipt('e2000000-0000-0000-0000-000000000002', encode('x'::bytea, 'base64'), 'image/jpeg') $$, true);
select t('Eko cannot open Budi''s receipt', $$ select get_callup_receipt('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b') $$, true);
select as_user('a0000000-0000-0000-0000-00000000000a');
select expect('the admin can', $$ get_callup_receipt('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b') ->> 'mime' = 'image/jpeg' $$);
select expect('the list puts the receipt to check first',
  $$ (select user_id from get_callup_payments('e2000000-0000-0000-0000-000000000002') limit 1) = 'b0000000-0000-0000-0000-00000000000b' $$);

\echo ''
\echo '=== The deadline (5 hours out) ==='
reset role;
select process_callup_payments() is not null;
select expect('Budi (receipt waiting) keeps his spot', $$ resp('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b') = 'in' $$);
select expect('Citra and Dewi (no receipt) go to the waiting list',
  $$ resp('e2000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c') = 'waitlist'
     and resp('e2000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000d') = 'waitlist' $$);
select expect('...and are told why', $$ (select count(*) from notifications where type = 'callup_moved_unpaid') = 2 $$);
select expect('Eko moves up (the queue, not the moved)',
  $$ resp('e2000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000e') = 'in' $$);
select expect('Dewi''s guest stays with Dewi on the waiting list',
  $$ (select response from club_event_guests where id = '90000000-0000-0000-0000-000000000001') = 'waitlist'
     and event_in_count('e2000000-0000-0000-0000-000000000002') = 2 $$);
select expect('Eko''s message gives him the hour', $$ exists (select 1 from notifications
   where user_id = 'e0000000-0000-0000-0000-00000000000e' and type = 'event_promoted' and body like '%Pay within 1 hour%') $$);
select expect('one message, not two', $$ (select count(*) from notifications where user_id = 'e0000000-0000-0000-0000-00000000000e') = 1 $$);

\echo ''
\echo '=== Eko''s hour runs out ==='
update club_event_payments set pay_by = now() - interval '1 minute'
 where event_id = 'e2000000-0000-0000-0000-000000000002' and user_id = 'e0000000-0000-0000-0000-00000000000e';
select process_callup_payments() is not null;
select expect('Eko goes back to the waiting list', $$ resp('e2000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000e') = 'waitlist' $$);
select expect('nobody who was moved for not paying is moved back up', $$ event_in_count('e2000000-0000-0000-0000-000000000002') = 1 $$);

\echo ''
\echo '=== Taking the open spot back ==='
set role authenticated;
select as_user('c0000000-0000-0000-0000-00000000000c');
select t('Citra answers I''m in again', $$ select set_event_rsvp('e2000000-0000-0000-0000-000000000002', 'in') $$);
select expect('she''s in, with an hour, and told so',
  $$ resp('e2000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c') = 'in'
     and (get_callup_extras('e2000000-0000-0000-0000-000000000002') -> 'me' ->> 'pay_by') is not null
     and exists (select 1 from notifications where user_id = 'c0000000-0000-0000-0000-00000000000c' and type = 'callup_pay') $$);

\echo ''
\echo '=== Rejecting, paying, stepping out ==='
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('admin rejects Budi''s receipt', $$ select set_callup_payment('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'reject', 'Wrong amount') $$);
reset role;
select expect('receipt gone, Budi told, with an hour', $$ not exists (select 1 from club_event_receipts where user_id = 'b0000000-0000-0000-0000-00000000000b')
   and exists (select 1 from notifications where user_id = 'b0000000-0000-0000-0000-00000000000b' and type = 'callup_receipt_rejected' and body like 'Wrong amount.%Upload a new one by%')
   and exists (select 1 from club_event_payments where user_id = 'b0000000-0000-0000-0000-00000000000b' and event_id = 'e2000000-0000-0000-0000-000000000002' and pay_by > now()) $$);
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('admin marks Budi paid (cash)', $$ select set_callup_payment('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'paid') $$);
select as_user('d0000000-0000-0000-0000-00000000000d');
select expect('members see "1 of 3 paid"', $$ (get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'paid_spots')::int = 1 $$);
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('Budi (paid) can''t make it', $$ select set_event_rsvp('e2000000-0000-0000-0000-000000000002', 'out') $$);
reset role;
select expect('the admin is told about the refund', $$ exists (select 1 from notifications where user_id = 'a0000000-0000-0000-0000-00000000000a' and type = 'callup_paid_left') $$);

\echo ''
\echo '=== The freeze, cancelling, deleting ==='
select process_callup_payments() is not null;
select expect('frozen night: unpaid Budi keeps his spot', $$ resp('e3000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b') = 'in' $$);
update club_events set status = 'cancelled' where id = 'e2000000-0000-0000-0000-000000000002';
select expect('cancelled: whoever paid is told about refunds', $$ exists (select 1 from notifications where user_id = 'b0000000-0000-0000-0000-00000000000b' and type = 'callup_cancelled_paid') $$);
insert into club_event_receipts (event_id, user_id, image, mime) values
  ('e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'x', 'image/jpeg');
update club_events set scheduled_at = now() - interval '4 days' where id = 'e1000000-0000-0000-0000-000000000001';
select process_callup_payments() is not null;
select expect('receipts are gone 3 days after the night', $$ not exists (select 1 from club_event_receipts where event_id = 'e1000000-0000-0000-0000-000000000001') $$);
select expect('the paid record stays', $$ exists (select 1 from club_event_payments where event_id = 'e1000000-0000-0000-0000-000000000001' and paid_at is not null) $$);

\echo ''
\echo '=== Switching receipts on late ==='
insert into club_events (id, club_id, title, scheduled_at, status, created_by, max_players, slug) values
  ('e4000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', 'Late switch', now() + interval '4 hours', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 4, 'late-n');
insert into club_event_rsvps (event_id, user_id, response) values ('e4000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-00000000000d', 'in');
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('admin switches to Receipt needed, 4 hours before', $$ select set_callup_options('e4000000-0000-0000-0000-000000000004', 'receipt', 'BCA 123') $$);
reset role;
select process_callup_payments() is not null;
select expect('Dewi isn''t moved: she got her hour', $$ resp('e4000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-00000000000d') = 'in'
   and exists (select 1 from club_event_payments where event_id = 'e4000000-0000-0000-0000-000000000004' and pay_by > now()) $$);
