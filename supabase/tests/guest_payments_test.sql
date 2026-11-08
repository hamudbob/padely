-- ---------------------------------------------------------------------
-- guest_payments_test.sql -- proves 0085: each guest pays for themselves.
-- ---------------------------------------------------------------------
\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin@t'), ('b0000000-0000-0000-0000-00000000000b', 'gilang@t'),
  ('c0000000-0000-0000-0000-00000000000c', 'citra@t');
insert into profiles (id, display_name) values
  ('a0000000-0000-0000-0000-00000000000a', 'Admin'), ('b0000000-0000-0000-0000-00000000000b', 'Gilang'),
  ('c0000000-0000-0000-0000-00000000000c', 'Citra')
on conflict (id) do update set display_name = excluded.display_name;
insert into clubs (id, name, club_code, created_by) values ('c1000000-0000-0000-0000-000000000001', 'Pler', 'PLR001', 'a0000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'owner'),
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'member');
-- Tick night (3 days out) and a receipt night (2 days out, before its deadline).
insert into club_events (id, club_id, title, scheduled_at, status, created_by, max_players, payment_mode) values
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Tick night', now() + interval '3 days', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 12, 'tick'),
  ('e2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Receipt night', now() + interval '2 days', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 12, 'receipt');

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
create or replace function gid(p_ev uuid, p_name text) returns uuid language sql security definer as
  $$ select id from club_event_guests where event_id = p_ev and display_name = p_name $$;
create or replace function notes_for(p_u uuid, p_type text) returns int language sql security definer as
  $$ select count(*)::int from notifications where user_id = p_u and type = p_type $$;
grant execute on function expect(text, text), t(text, text, bool), as_user(uuid), gid(uuid, text), notes_for(uuid, text) to authenticated;
set client_min_messages = notice;
set role authenticated;

\echo ''
\echo '=== Tick only: each guest ticked on their own ==='
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('Gilang answers in and brings Andi and Bima', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in'),
  add_event_guest('e1000000-0000-0000-0000-000000000001', 'Andi'), add_event_guest('e1000000-0000-0000-0000-000000000001', 'Bima') $$);
select expect('3 spots to pay for', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'in_spots')::int = 3 $$);
select expect('Gilang''s own spot is just 1', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'me' ->> 'spots')::int = 1 $$);
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('admin ticks Gilang', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'paid') $$);
select expect('1 of 3 paid: his guests are not covered', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'paid_spots')::int = 1 $$);
select expect('the admin list names each guest', $$ (select array_agg(display_name order by display_name) from get_callup_guest_payments('e1000000-0000-0000-0000-000000000001')) = array['Andi','Bima'] $$);
select t('admin ticks Andi', $$ select set_guest_payment(gid('e1000000-0000-0000-0000-000000000001', 'Andi'), 'paid') $$);
select expect('2 of 3 paid', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'paid_spots')::int = 2 $$);
select t('no receipts on a Tick night', $$ select 1 $$);
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('...so Gilang can''t upload for Bima', $$ select upload_guest_receipt(gid('e1000000-0000-0000-0000-000000000001', 'Bima'), 'aGVsbG8=', 'image/png') $$, true);
select expect('Gilang sees Andi paid, Bima not', $$ (select bool_and(case x ->> 'name' when 'Andi' then (x ->> 'paid')::boolean else not (x ->> 'paid')::boolean end)
   from jsonb_array_elements(get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'my_guests') x) $$);
select as_user('c0000000-0000-0000-0000-00000000000c');
select t('a member cannot tick a guest', $$ select set_guest_payment(gid('e1000000-0000-0000-0000-000000000001', 'Bima'), 'paid') $$, true);

\echo ''
\echo '=== Receipt needed: Gilang uploads for each guest ==='
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('Gilang answers in and brings Andi', $$ select set_event_rsvp('e2000000-0000-0000-0000-000000000002', 'in'), add_event_guest('e2000000-0000-0000-0000-000000000002', 'Andi') $$);
select t('Gilang uploads his own receipt', $$ select upload_callup_receipt('e2000000-0000-0000-0000-000000000002', 'aGVsbG8=', 'image/png') $$);
select t('...and Andi''s', $$ select upload_guest_receipt(gid('e2000000-0000-0000-0000-000000000002', 'Andi'), 'aGVsbG8=', 'image/png') $$);
select expect('Gilang can open Andi''s receipt', $$ get_guest_receipt(gid('e2000000-0000-0000-0000-000000000002', 'Andi')) ->> 'mime' = 'image/png' $$);
select as_user('c0000000-0000-0000-0000-00000000000c');
select t('Citra can''t open it', $$ select get_guest_receipt(gid('e2000000-0000-0000-0000-000000000002', 'Andi')) $$, true);
select t('...or upload for him', $$ select upload_guest_receipt(gid('e2000000-0000-0000-0000-000000000002', 'Andi'), 'aGVsbG8=', 'image/png') $$, true);
select as_user('a0000000-0000-0000-0000-00000000000a');
select expect('Needs you counts 2 receipts to check', $$ (select to_check from get_club_admin_todo('c1000000-0000-0000-0000-000000000001') where event_id = 'e2000000-0000-0000-0000-000000000002') = 2 $$);
select t('admin rejects Andi''s receipt', $$ select set_guest_payment(gid('e2000000-0000-0000-0000-000000000002', 'Andi'), 'reject', 'Blurry') $$);
select expect('Gilang is told, by name', $$ exists (select 1 from notifications where user_id = 'b0000000-0000-0000-0000-00000000000b'
   and type = 'callup_receipt_rejected' and title like '%Andi%' and body like 'Blurry%') $$);
select expect('Andi''s receipt is gone, the reason stays', $$ exists (select 1 from get_callup_guest_payments('e2000000-0000-0000-0000-000000000002')
   where display_name = 'Andi' and not has_receipt and rejected_reason = 'Blurry') $$);

\echo ''
\echo '=== The deadline, guest by guest ==='
reset role;
update club_events set scheduled_at = now() + interval '5 hours' where id = 'e2000000-0000-0000-0000-000000000002';
select process_callup_payments() is not null;
select expect('Gilang (receipt waiting) keeps his spot', $$ (select response from club_event_rsvps where event_id = 'e2000000-0000-0000-0000-000000000002' and user_id = 'b0000000-0000-0000-0000-00000000000b') = 'in' $$);
select expect('Andi (no receipt) moves to the waiting list on his own', $$ (select response from club_event_guests where id = gid('e2000000-0000-0000-0000-000000000002', 'Andi')) = 'waitlist' $$);
select expect('Gilang is told it was Andi''s spot', $$ exists (select 1 from notifications where user_id = 'b0000000-0000-0000-0000-00000000000b'
   and type = 'callup_moved_unpaid' and title like 'Andi%') $$);

\echo ''
\echo '=== Guests who were already there when 0085 ran ==='
insert into club_events (id, club_id, title, scheduled_at, status, created_by, max_players, payment_mode) values
  ('e3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'Old night', now() + interval '5 hours', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 12, 'receipt');
insert into club_event_guests (id, event_id, display_name, invited_by, response) values
  ('90000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003', 'Old guest', 'b0000000-0000-0000-0000-00000000000b', 'in');
insert into club_event_guest_payments (guest_id, event_id, deadline_applies) values ('90000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003', false)
on conflict (guest_id) do update set deadline_applies = false, pay_by = null;
select process_callup_payments() is not null;
select expect('...are not moved by the deadline', $$ (select response from club_event_guests where id = '90000000-0000-0000-0000-000000000003') = 'in' $$);

\echo ''
\echo '=== Taking a paid guest off, calling a night off ==='
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('admin ticks Bima', $$ select set_guest_payment(gid('e1000000-0000-0000-0000-000000000001', 'Bima'), 'paid') $$);
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('Gilang takes Bima off', $$ select remove_event_guest(gid('e1000000-0000-0000-0000-000000000001', 'Bima')) $$);
select expect('the admins hear that a paid guest was taken off', $$ exists (select 1 from notifications where user_id = 'a0000000-0000-0000-0000-00000000000a'
   and type = 'callup_paid_left' and title like 'Bima%') $$);
reset role;
update club_events set status = 'cancelled' where id = 'e1000000-0000-0000-0000-000000000001';
select expect('calling it off tells Gilang he''d paid for Andi', $$ exists (select 1 from notifications where user_id = 'b0000000-0000-0000-0000-00000000000b'
   and type = 'callup_cancelled_paid' and body like '%Andi%') $$);
set role authenticated;
select t('the guest payments table is not readable directly', $$ select * from club_event_guest_payments $$, true);
reset role;
