-- ---------------------------------------------------------------------
-- pay_after_test.sql -- proves 0082: paying after the night.
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
insert into teams (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Host');
insert into clubs (id, name, club_code, created_by) values
  ('c1000000-0000-0000-0000-000000000001', 'Kemang', 'KEM001', 'a0000000-0000-0000-0000-00000000000a');
insert into club_members (club_id, user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'owner'),
  ('c1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'member'),
  ('c1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'member');

-- Tonight, tick only. Admin, Budi, Citra and Dewi said in; Dewi brings Rina.
insert into club_events (id, club_id, title, scheduled_at, status, created_by, payment_mode, cost) values
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Tuesday', now() + interval '3 hours', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 'tick', 'IDR 120k');
insert into club_event_rsvps (event_id, user_id, response) values
  ('e1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'in'),
  ('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'in'),
  ('e1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000c', 'in'),
  ('e1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'in');
insert into club_event_guests (event_id, display_name, gender, invited_by, response) values
  ('e1000000-0000-0000-0000-000000000001', 'Rina', 'F', 'd0000000-0000-0000-0000-00000000000d', 'in');

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
grant execute on function expect(text, text), t(text, text, bool), as_user(uuid) to authenticated;
set client_min_messages = notice;

\echo ''
\echo '=== Before the night: the answers decide ==='
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
select expect('not played yet', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'played')::boolean = false $$);
select expect('5 spots in (4 members + Rina)', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'in_spots')::int = 5 $$);
select expect('nothing to collect yet', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') = 0 $$);

-- The session starts. Citra didn't come; Eko turned up without answering;
-- Rina came with Dewi; Joko walked in. The roster syncs.
reset role;
insert into sessions (id, team_id, club_id, name, format, scoring_format, ranking_basis, status, join_code, public_token, scheduling_seed, created_by) values
  ('5e000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   'Tuesday', 'mexicano', 'fixed_21', 'points_first', 'live', '111111', 'tok-1', 1, 'a0000000-0000-0000-0000-00000000000a');
update club_events set session_id = '5e000000-0000-0000-0000-000000000001' where id = 'e1000000-0000-0000-0000-000000000001';

\echo ''
\echo '=== Started, roster not synced yet: still the answers ==='
set role authenticated;
select expect('no roster on the server: not "played"', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'played')::boolean = false $$);
select expect('still 5 spots', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'in_spots')::int = 5 $$);

reset role;
insert into players (session_id, display_name, linked_user_id, status, matches_played) values
  ('5e000000-0000-0000-0000-000000000001', 'Admin', 'a0000000-0000-0000-0000-00000000000a', 'active', 3),
  ('5e000000-0000-0000-0000-000000000001', 'Budi',  'b0000000-0000-0000-0000-00000000000b', 'active', 3),
  ('5e000000-0000-0000-0000-000000000001', 'Dewi',  'd0000000-0000-0000-0000-00000000000d', 'active', 3),
  ('5e000000-0000-0000-0000-000000000001', 'Eko',   'e0000000-0000-0000-0000-00000000000e', 'active', 2),
  ('5e000000-0000-0000-0000-000000000001', ' rina ', null, 'active', 3),
  ('5e000000-0000-0000-0000-000000000001', 'Joko',  null, 'active', 3),
  ('5e000000-0000-0000-0000-000000000001', 'Gone Early', null, 'left', 0);

\echo ''
\echo '=== After the roster syncs: who played decides ==='
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
select expect('played', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'played')::boolean $$);
select expect('6 spots: Admin, Budi, Dewi+Rina, Eko, Joko', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'in_spots')::int = 6 $$);
select expect('Citra (no-show) does not owe', $$ not exists (select 1 from get_callup_payments('e1000000-0000-0000-0000-000000000001') where user_id = 'c0000000-0000-0000-0000-00000000000c') $$);
select expect('Eko (came without answering) owes', $$ exists (select 1 from get_callup_payments('e1000000-0000-0000-0000-000000000001') where user_id = 'e0000000-0000-0000-0000-00000000000e' and own_in) $$);
select expect('Rina has her own row, as Dewi''s guest', $$ exists (select 1 from get_callup_guest_payments('e1000000-0000-0000-0000-000000000001')
   where display_name = 'Rina' and invited_by = 'd0000000-0000-0000-0000-00000000000d' and holds_spot) $$);
select expect('Joko is the only walk-in', $$ (select array_agg(display_name) from get_callup_walkins('e1000000-0000-0000-0000-000000000001')) = array['Joko'] $$);
select expect('someone who left without playing is not counted', $$ not exists (select 1 from get_callup_walkins('e1000000-0000-0000-0000-000000000001') where display_name = 'Gone Early') $$);
select expect('admin sees Tuesday to collect, 0 of 6', $$ (select (x ->> 'in_spots')::int = 6 and (x ->> 'paid_spots')::int = 0 from jsonb_array_elements(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') x) $$);

select as_user('d0000000-0000-0000-0000-00000000000d');
select expect('Dewi owes 2 spots', $$ (select (x ->> 'spots')::int = 2 from jsonb_array_elements(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'owe') x) $$);
select expect('a member sees no collect list', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') = 0 $$);
select t('a member cannot see the walk-ins', $$ select * from get_callup_walkins('e1000000-0000-0000-0000-000000000001') $$, true);
select t('a member cannot tick a walk-in', $$ select set_callup_walkin_payment('e1000000-0000-0000-0000-000000000001', 'joko', true) $$, true);
select t('a member cannot close collecting', $$ select set_callup_collecting('e1000000-0000-0000-0000-000000000001', true) $$, true);
select as_user('c0000000-0000-0000-0000-00000000000c');
select expect('Citra owes nothing', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'owe') = 0 $$);
select as_user('f0000000-0000-0000-0000-00000000000f');
select t('a stranger cannot read the club''s money', $$ select get_club_money('c1000000-0000-0000-0000-000000000001') $$, true);

\echo ''
\echo '=== Ticking after the night ==='
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('admin ticks Dewi', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000d', 'paid') $$);
select t('admin ticks Joko the walk-in', $$ select set_callup_walkin_payment('e1000000-0000-0000-0000-000000000001', 'joko', true) $$);
select t('a name not on the roster is refused', $$ select set_callup_walkin_payment('e1000000-0000-0000-0000-000000000001', 'nobody', true) $$, true);
select expect('2 of 6 paid (Dewi''s payment doesn''t cover Rina)', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'paid_spots')::int = 2 $$);
select as_user('d0000000-0000-0000-0000-00000000000d');
select expect('Dewi still owes 1, for Rina', $$ (select (x ->> 'spots')::int = 1 from jsonb_array_elements(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'owe') x) $$);
select expect('Dewi sees herself paid on the Call-up', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'me' ->> 'paid')::boolean $$);
select expect('...and Rina, played and not paid, under "your guests"', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'my_guests' -> 0 ->> 'name') = 'Rina'
   and (get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'my_guests' -> 0 ->> 'played')::boolean
   and not (get_callup_extras('e1000000-0000-0000-0000-000000000001') -> 'my_guests' -> 0 ->> 'paid')::boolean $$);

select as_user('a0000000-0000-0000-0000-00000000000a');
select t('untick Joko', $$ select set_callup_walkin_payment('e1000000-0000-0000-0000-000000000001', 'joko', false) $$);
select expect('1 of 6 again', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'paid_spots')::int = 1 $$);
select t('tick Rina on her own', $$ select set_guest_payment((select id from club_event_guests where display_name = 'Rina'), 'paid') $$);
select as_user('d0000000-0000-0000-0000-00000000000d');
select expect('now Dewi owes nothing', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'owe') = 0 $$);
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('tick Joko, Admin, Budi, Eko', $$ select set_callup_walkin_payment('e1000000-0000-0000-0000-000000000001', 'joko', true),
  set_callup_payment('e1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'paid'),
  set_callup_payment('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'paid'),
  set_callup_payment('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000e', 'paid') $$);
select expect('everyone paid: Tuesday leaves the collect list', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') = 0 $$);

\echo ''
\echo '=== Done collecting ==='
select t('Budi unticked again', $$ select set_callup_payment('e1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'unpaid') $$);
select expect('back on the list', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') = 1 $$);
select t('admin taps Done collecting', $$ select set_callup_collecting('e1000000-0000-0000-0000-000000000001', true) $$);
select expect('gone from the list', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') = 0 $$);
select expect('the Call-up says closed', $$ (get_callup_extras('e1000000-0000-0000-0000-000000000001') ->> 'collecting_closed')::boolean $$);
select as_user('b0000000-0000-0000-0000-00000000000b');
select expect('Budi''s reminder is gone too', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'owe') = 0 $$);
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('reopen', $$ select set_callup_collecting('e1000000-0000-0000-0000-000000000001', false) $$);
select expect('back again', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') = 1 $$);

\echo ''
\echo '=== Nights that never count ==='
reset role;
update club_events set payment_mode = 'none' where id = 'e1000000-0000-0000-0000-000000000001';
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
select expect('no payment: nothing to collect', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') = 0 $$);
reset role;
update club_events set payment_mode = 'tick', status = 'cancelled' where id = 'e1000000-0000-0000-0000-000000000001';
set role authenticated;
select expect('called off: nothing to collect', $$ jsonb_array_length(get_club_money('c1000000-0000-0000-0000-000000000001') -> 'collect') = 0 $$);
select t('internals are not callable', $$ select * from callup_roster('e1000000-0000-0000-0000-000000000001') $$, true);
reset role;
