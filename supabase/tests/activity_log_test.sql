-- ---------------------------------------------------------------------
-- activity_log_test.sql -- proves 0086: the Call-up activity log.
-- ---------------------------------------------------------------------
\set ON_ERROR_STOP off
\set QUIET on
set client_min_messages = warning;
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'hamud@t'), ('b0000000-0000-0000-0000-00000000000b', 'budi@t'),
  ('c0000000-0000-0000-0000-00000000000c', 'citra@t'), ('d0000000-0000-0000-0000-00000000000d', 'dewi@t');
insert into profiles (id, display_name) values
  ('a0000000-0000-0000-0000-00000000000a', 'Hamud'), ('b0000000-0000-0000-0000-00000000000b', 'Budi'),
  ('c0000000-0000-0000-0000-00000000000c', 'Citra'), ('d0000000-0000-0000-0000-00000000000d', 'Dewi')
on conflict (id) do update set display_name = excluded.display_name;
insert into clubs (id, name, club_code, created_by) values ('c1000000-0000-0000-0000-000000000001', 'Pler', 'PLR001', 'a0000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'owner'),
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'member');

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
-- The newest log line matching an action for a subject: "actor|action".
create or replace function last_log(p_subject text, p_action text) returns text language sql security definer as
  $$ select coalesce(pr.display_name, 'Padelier') || '|' || l.action from club_event_log l left join profiles pr on pr.id = l.actor_id
      where l.subject_name = p_subject and l.action = p_action order by l.id desc limit 1 $$;
create or replace function gid(p_name text) returns uuid language sql security definer as
  $$ select id from club_event_guests where display_name = p_name $$;
grant execute on function expect(text, text), t(text, text, bool), as_user(uuid), last_log(text, text), gid(text) to authenticated;
set client_min_messages = notice;

-- A full night: 2 places, receipts, starting in 5 hours (past the deadline).
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
insert into club_events (id, club_id, title, scheduled_at, status, created_by, max_players, payment_mode) values
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Tuesday', now() + interval '5 hours', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 2, 'receipt');

\echo ''
\echo '=== Players ==='
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('Budi answers in', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in') $$);
select t('Budi uploads a receipt', $$ select upload_callup_receipt('e1000000-0000-0000-0000-000000000001', 'aGVsbG8=', 'image/png') $$);
select as_user('c0000000-0000-0000-0000-00000000000c');
select t('Citra answers in', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in') $$);
select as_user('d0000000-0000-0000-0000-00000000000d');
select t('Dewi answers in (full: waiting list)', $$ select set_event_rsvp('e1000000-0000-0000-0000-000000000001', 'in') $$);
select t('Dewi brings Rina (waiting)', $$ select add_event_guest('e1000000-0000-0000-0000-000000000001', 'Rina', 'F') $$);
select expect('Budi answered in', $$ last_log('Budi', 'answered_in') = 'Budi|answered_in' $$);
select expect('Budi uploaded a receipt', $$ last_log('Budi', 'receipt_uploaded') = 'Budi|receipt_uploaded' $$);
select expect('Citra got her hour, from Padelier', $$ last_log('Citra', 'pay_window') = 'Padelier|pay_window' $$);
select expect('Dewi joined the waiting list', $$ last_log('Dewi', 'joined_waitlist') = 'Dewi|joined_waitlist' $$);
select expect('Rina was added by Dewi', $$ last_log('Rina', 'guest_added') = 'Dewi|guest_added'
   and (select detail ->> 'guest_of' from club_event_log where action = 'guest_added') = 'Dewi' $$);
select expect('times are kept to the fraction of a second, in order', $$ (select bool_and(at > lag_at) from
   (select at, lag(at) over (order by id) as lag_at from club_event_log) x where lag_at is not null) $$);

\echo ''
\echo '=== Admin actions carry the admin''s name ==='
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('Hamud accepts Budi''s receipt', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'paid') $$);
select expect('logged as Hamud accepting', $$ last_log('Budi', 'receipt_accepted') = 'Hamud|receipt_accepted' $$);
select expect('the Payments list says who', $$ (select paid_by_name from get_callup_payments('e1000000-0000-0000-0000-000000000001') where display_name = 'Budi') = 'Hamud' $$);
select t('Hamud takes Citra out', $$ select event_set_member_rsvp('e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'out') $$);
select expect('logged as Hamud taking Citra out', $$ last_log('Citra', 'admin_took_out') = 'Hamud|admin_took_out' $$);
select expect('Dewi moved up by Padelier, not by Hamud', $$ last_log('Dewi', 'moved_up') = 'Padelier|moved_up' $$);
select t('Hamud moves Rina in (over the cap, like a member)', $$ select event_set_guest_rsvp(gid('Rina'), 'in') $$);
select expect('Rina is in', $$ (select response from club_event_guests where id = gid('Rina')) = 'in' $$);
select expect('logged as Hamud moving Rina in', $$ last_log('Rina', 'admin_moved_in') = 'Hamud|admin_moved_in' $$);
select expect('Dewi was told her guest is in', $$ exists (select 1 from notifications where user_id = 'd0000000-0000-0000-0000-00000000000d' and title like 'Rina is in%') $$);
select t('Hamud marks Rina paid', $$ select set_guest_payment(gid('Rina'), 'paid') $$);
select expect('logged, and named on the guest''s row', $$ last_log('Rina', 'marked_paid') = 'Hamud|marked_paid'
   and (select paid_by_name from get_callup_guest_payments('e1000000-0000-0000-0000-000000000001') where display_name = 'Rina') = 'Hamud' $$);
select as_user('d0000000-0000-0000-0000-00000000000d');
select t('a member cannot move a guest', $$ select event_set_guest_rsvp(gid('Rina'), 'waitlist') $$, true);
select t('a member cannot read the log', $$ select * from get_callup_log('e1000000-0000-0000-0000-000000000001') $$, true);
select t('nor the table', $$ select * from club_event_log $$, true);

\echo ''
\echo '=== Padelier''s own moves ==='
reset role;
update club_event_payments set pay_by = now() - interval '1 minute' where user_id = 'd0000000-0000-0000-0000-00000000000d';
select process_callup_payments() is not null;
select expect('Dewi moved down for not paying, by Padelier, with the reason', $$ last_log('Dewi', 'moved_to_waitlist') = 'Padelier|moved_to_waitlist'
   and (select detail ->> 'cause' from club_event_log where subject_name = 'Dewi' and action = 'moved_to_waitlist' order by id desc limit 1) = 'unpaid' $$);

\echo ''
\echo '=== Reading it ==='
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
reset role;
update club_events set status = 'cancelled' where id = 'e1000000-0000-0000-0000-000000000001';
set role authenticated;
select expect('the admin reads it newest first', $$ (select action from get_callup_log('e1000000-0000-0000-0000-000000000001') limit 1) = 'called_off' $$);
select expect('posted is the very first line, by Hamud', $$ (select actor_name || '|' || action from get_callup_log('e1000000-0000-0000-0000-000000000001') order by at asc limit 1) = 'Hamud|posted' $$);
select expect('automatic lines are flagged', $$ (select bool_and(automatic) from get_callup_log('e1000000-0000-0000-0000-000000000001') where action in ('moved_up', 'pay_window')) $$);
reset role;
