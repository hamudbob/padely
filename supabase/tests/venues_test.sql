-- ---------------------------------------------------------------------
-- venues_test.sql -- proves 0081: saved venues and the admin to-do.
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


insert into club_events (id, club_id, title, scheduled_at, status, created_by, location, payment_mode) values
  ('e1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Old night', now() - interval '20 days', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', 'Kemang Padel', 'none'),
  ('e2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'Tuesday', now() + interval '2 days', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', null, 'receipt'),
  ('e3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'Friday', now() + interval '5 days', 'scheduled', 'a0000000-0000-0000-0000-00000000000a', null, 'none');
-- Re-run the backfill part of 0081 now that a past night with a place exists.
insert into club_venues (club_id, name, name_key, use_count, last_used_at)
select e.club_id, min(btrim(e.location)), venue_key(e.location), count(*)::int, max(e.scheduled_at)
  from club_events e where nullif(btrim(coalesce(e.location, '')), '') is not null
 group by e.club_id, venue_key(e.location)
on conflict (club_id, name_key) do nothing;
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
\echo '=== Links ==='
select expect('a Google Maps short link is kept', $$ clean_maps_url('https://maps.app.goo.gl/abc123') is not null $$);
select expect('google.co.id/maps is kept', $$ clean_maps_url('https://www.google.co.id/maps/place/Kemang') is not null $$);
select expect('Apple Maps is kept', $$ clean_maps_url('https://maps.apple.com/?q=Kemang') is not null $$);
select expect('any other site is dropped', $$ clean_maps_url('https://evil.example/maps') is null $$);
select expect('a look-alike host is dropped', $$ clean_maps_url('https://maps.app.goo.gl.evil.com/x') is null $$);
select expect('http (not https) is dropped', $$ clean_maps_url('http://maps.app.goo.gl/abc') is null $$);
select expect('javascript: is dropped', $$ clean_maps_url('javascript:alert(1)') is null $$);
select expect('quotes are dropped', $$ clean_maps_url('https://maps.app.goo.gl/a"onload=x') is null $$);

\echo ''
\echo '=== Saving a place with a Call-up ==='
set role authenticated;
select as_user('a0000000-0000-0000-0000-00000000000a');
select expect('the old night''s place is already saved', $$ (select count(*) from list_club_venues('c1000000-0000-0000-0000-000000000001') where name = 'Kemang Padel') = 1 $$);
select t('admin posts Tuesday at "kemang  padel" with a link', $$ select set_callup_venue('e2000000-0000-0000-0000-000000000002', '  kemang  padel ', 'https://maps.app.goo.gl/kem') $$);
select expect('one venue, not two (case and spacing ignored)', $$ (select count(*) from list_club_venues('c1000000-0000-0000-0000-000000000001')) = 1 $$);
select expect('the night uses the saved spelling', $$ (select location from club_events where id = 'e2000000-0000-0000-0000-000000000002') = 'Kemang Padel' $$);
select expect('the link is saved on the venue', $$ (select maps_url from list_club_venues('c1000000-0000-0000-0000-000000000001') limit 1) = 'https://maps.app.goo.gl/kem' $$);
select expect('used twice now', $$ (select use_count from list_club_venues('c1000000-0000-0000-0000-000000000001') limit 1) = 2 $$);
select expect('the night carries the link', $$ (get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'location_url') = 'https://maps.app.goo.gl/kem' $$);
select t('Friday at the same place, no link given', $$ select set_callup_venue('e3000000-0000-0000-0000-000000000003', 'Kemang padel') $$);
select expect('...gets the saved link anyway', $$ (get_callup_extras('e3000000-0000-0000-0000-000000000003') ->> 'location_url') = 'https://maps.app.goo.gl/kem' $$);
select t('editing the link only does not count as another night', $$ select set_callup_venue('e3000000-0000-0000-0000-000000000003', 'Kemang padel', 'https://maps.app.goo.gl/kem2', false) $$);
select expect('still 3 uses, link updated', $$ (select use_count = 3 and maps_url = 'https://maps.app.goo.gl/kem2' from list_club_venues('c1000000-0000-0000-0000-000000000001') limit 1) $$);
select t('a non-maps link is refused', $$ select set_callup_venue('e3000000-0000-0000-0000-000000000003', 'Senayan', 'https://evil.example/x') $$, true);
select t('a new place with no link', $$ select set_callup_venue('e3000000-0000-0000-0000-000000000003', 'Senayan Arena') $$);
select expect('two venues now', $$ (select count(*) from list_club_venues('c1000000-0000-0000-0000-000000000001')) = 2 $$);
select t('clearing the place', $$ select set_callup_venue('e3000000-0000-0000-0000-000000000003', '  ') $$);
select expect('Friday has no place', $$ (select location is null and location_url is null from club_events where id = 'e3000000-0000-0000-0000-000000000003') $$);

\echo ''
\echo '=== Who can ==='
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('a member cannot list venues', $$ select * from list_club_venues('c1000000-0000-0000-0000-000000000001') $$, true);
select t('a member cannot set a place', $$ select set_callup_venue('e2000000-0000-0000-0000-000000000002', 'My house') $$, true);
select t('a member cannot read the venues table', $$ select * from club_venues $$, true);
select t('a member cannot see the admin to-do', $$ select * from get_club_admin_todo('c1000000-0000-0000-0000-000000000001') $$, true);
select expect('a member sees the night''s map link', $$ (get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'location_url') = 'https://maps.app.goo.gl/kem' $$);
select as_user('f0000000-0000-0000-0000-00000000000f');
select expect('so does a stranger (it''s on the public page too)', $$ (get_callup_extras('e2000000-0000-0000-0000-000000000002') ->> 'location_url') = 'https://maps.app.goo.gl/kem' $$);

\echo ''
\echo '=== Fixing a venue ==='
select as_user('a0000000-0000-0000-0000-00000000000a');
select t('rename and fix the link', $$ select update_club_venue((select id from list_club_venues('c1000000-0000-0000-0000-000000000001') where name ilike 'kemang%'), 'Kemang Padel Club', 'https://maps.apple.com/?q=kemang') $$);
select expect('upcoming nights there follow the new name and link', $$ (select location = 'Kemang Padel Club' and location_url = 'https://maps.apple.com/?q=kemang' from club_events where id = 'e2000000-0000-0000-0000-000000000002') $$);
select expect('a past night keeps what it said', $$ (select location from club_events where id = 'e1000000-0000-0000-0000-000000000001') = 'Kemang Padel' $$);
select t('renaming onto another venue is refused', $$ select update_club_venue((select id from list_club_venues('c1000000-0000-0000-0000-000000000001') where name = 'Kemang Padel Club'), 'senayan arena', null) $$, true);
select t('delete Senayan', $$ select delete_club_venue((select id from list_club_venues('c1000000-0000-0000-0000-000000000001') where name = 'Senayan Arena')) $$);
select expect('one left', $$ (select count(*) from list_club_venues('c1000000-0000-0000-0000-000000000001')) = 1 $$);

\echo ''
\echo '=== Needs you: receipts to check ==='
reset role;
insert into club_event_rsvps (event_id, user_id, response) values
  ('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'in'),
  ('e2000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c', 'in');
set role authenticated;
select as_user('b0000000-0000-0000-0000-00000000000b');
select t('Budi uploads a receipt', $$ select upload_callup_receipt('e2000000-0000-0000-0000-000000000002', encode('img'::bytea, 'base64'), 'image/jpeg') $$);
select as_user('a0000000-0000-0000-0000-00000000000a');
select expect('the admin sees 1 to check on Tuesday', $$ (select to_check from get_club_admin_todo('c1000000-0000-0000-0000-000000000001') where event_id = 'e2000000-0000-0000-0000-000000000002') = 1 $$);
select t('admin accepts it', $$ select set_callup_payment('e2000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'paid') $$);
select expect('nothing left to check', $$ (select count(*) from get_club_admin_todo('c1000000-0000-0000-0000-000000000001')) = 0 $$);
reset role;
