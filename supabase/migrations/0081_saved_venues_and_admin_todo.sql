-- ---------------------------------------------------------------------
-- 0081_saved_venues_and_admin_todo.sql
--
-- The club page redesign (ADR-002, Hamud 7 Nov 2026). Run AFTER 0080.
--
-- 1. Saved venues. Each club keeps the places it plays, with a map link.
--    There is no "add venue" screen: posting a Call-up saves its place (and
--    the link, when given) automatically, and the next Call-up offers it in a
--    drop-down. Names match ignoring case and spacing. Only real Google Maps
--    or Apple Maps links are kept, so nobody can put any other link in front
--    of the members. club_events.location_url is the link for that night.
--
-- 2. get_club_admin_todo: what the club page's "Needs you" panel shows the
--    owner and admins (receipts waiting to be checked, per upcoming night).
--
-- 3. get_callup_extras now also returns location_url.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- ── 1. Venues ─────────────────────────────────────────────────────────
alter table club_events add column if not exists location_url text;

create table if not exists club_venues (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id) on delete cascade,
  name         text not null,
  -- Lower case, single spaces: "Kemang  Padel" and "kemang padel" are one place.
  name_key     text not null,
  maps_url     text,
  use_count    int not null default 0,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (club_id, name_key)
);
alter table club_venues enable row level security;
revoke all on club_venues from anon, authenticated;
-- No policies: read and written only through the functions below.

create or replace function venue_key(p_name text) returns text
language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

-- A map link we are willing to show: https, and a maps host. Anything else
-- comes back null (the app then falls back to a Google Maps search).
create or replace function clean_maps_url(p_url text) returns text
language plpgsql immutable as $$
declare v text := btrim(coalesce(p_url, ''));
begin
  if v = '' or char_length(v) > 500 then return null; end if;
  if v ~* '^https://(maps\.app\.goo\.gl|goo\.gl/maps|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+/maps|maps\.apple\.com)(/|\?|$)'
     and v !~ '[\s<>"'']' then
    return v;
  end if;
  return null;
end;
$$;

-- Admin: the club's saved places, most used first.
create or replace function list_club_venues(p_club_id uuid)
returns table (id uuid, name text, maps_url text, use_count int, last_used_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_club_admin(p_club_id) or is_app_admin()) then
    raise exception 'Only the club''s owner and admins can see saved venues.' using errcode = 'P0001';
  end if;
  return query
    select v.id, v.name, v.maps_url, v.use_count, v.last_used_at
      from club_venues v where v.club_id = p_club_id
     order by v.use_count desc, v.last_used_at desc, v.name
     limit 50;
end;
$$;

-- Admin: the place for one Call-up. Saves (or updates) the venue on the way.
-- An empty name clears the place. A link given is kept on the venue for next
-- time; no link keeps whatever the venue already had.
-- p_count: this is another night at the place (posting, or moving a night
-- there), so it moves up the drop-down. Editing the link alone doesn't count.
create or replace function set_callup_venue(p_event_id uuid, p_name text, p_maps_url text default null, p_count boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev club_events%rowtype;
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_url text := clean_maps_url(p_maps_url);
  v_venue club_venues%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then raise exception 'That Call-up no longer exists.' using errcode = 'P0002'; end if;
  if not (is_club_admin(v_ev.club_id) or is_app_admin()) then
    raise exception 'Only the club''s owner and admins can change this.' using errcode = 'P0001';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'Keep the place name under 120 characters.' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_maps_url, '')) <> '' and v_url is null then
    raise exception 'That doesn''t look like a Google Maps or Apple Maps link.' using errcode = 'P0001';
  end if;

  if v_name is null then
    update club_events set location = null, location_url = null where id = p_event_id;
    return jsonb_build_object('location', null, 'location_url', null);
  end if;

  insert into club_venues (club_id, name, name_key, maps_url, use_count, last_used_at)
  values (v_ev.club_id, v_name, venue_key(v_name), v_url, case when p_count then 1 else 0 end, now())
  on conflict (club_id, name_key) do update
    -- The saved spelling stays: typing "kemang padel" doesn't rename
    -- "Kemang Padel".
    set maps_url = coalesce(excluded.maps_url, club_venues.maps_url),
        use_count = club_venues.use_count + case when p_count then 1 else 0 end,
        last_used_at = now()
  returning * into v_venue;

  update club_events set location = v_venue.name, location_url = v_venue.maps_url where id = p_event_id;
  return jsonb_build_object('location', v_venue.name, 'location_url', v_venue.maps_url, 'venue_id', v_venue.id);
end;
$$;

-- Admin: fix a venue's name or link, from Club settings.
create or replace function update_club_venue(p_venue_id uuid, p_name text, p_maps_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_v club_venues%rowtype;
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  v_url text := clean_maps_url(p_maps_url);
  v_old_key text;
begin
  select * into v_v from club_venues where id = p_venue_id for update;
  v_old_key := v_v.name_key;
  if not found then raise exception 'That venue is gone.' using errcode = 'P0002'; end if;
  if not (is_club_admin(v_v.club_id) or is_app_admin()) then
    raise exception 'Only the club''s owner and admins can change venues.' using errcode = 'P0001';
  end if;
  if v_name is null or char_length(v_name) > 120 then
    raise exception 'Give the venue a name (under 120 characters).' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_maps_url, '')) <> '' and v_url is null then
    raise exception 'That doesn''t look like a Google Maps or Apple Maps link.' using errcode = 'P0001';
  end if;
  if exists (select 1 from club_venues where club_id = v_v.club_id and name_key = venue_key(v_name) and id <> p_venue_id) then
    raise exception 'There''s already a venue with that name.' using errcode = 'P0001';
  end if;
  update club_venues set name = v_name, name_key = venue_key(v_name), maps_url = v_url where id = p_venue_id
  returning * into v_v;
  -- Upcoming nights at this place pick up the corrected name and link.
  update club_events set location = v_v.name, location_url = v_v.maps_url
   where club_id = v_v.club_id and status = 'scheduled' and scheduled_at > now()
     and venue_key(location) = v_old_key;
  return jsonb_build_object('id', v_v.id, 'name', v_v.name, 'maps_url', v_v.maps_url);
end;
$$;

create or replace function delete_club_venue(p_venue_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_club uuid;
begin
  select club_id into v_club from club_venues where id = p_venue_id;
  if v_club is null then return; end if;
  if not (is_club_admin(v_club) or is_app_admin()) then
    raise exception 'Only the club''s owner and admins can change venues.' using errcode = 'P0001';
  end if;
  -- Nights already posted keep their place; it just isn't offered any more.
  delete from club_venues where id = p_venue_id;
end;
$$;

-- Venues the club already played at, so the drop-down isn't empty on day one.
insert into club_venues (club_id, name, name_key, use_count, last_used_at)
select e.club_id, min(btrim(e.location)), venue_key(e.location), count(*)::int, max(e.scheduled_at)
  from club_events e
 where nullif(btrim(coalesce(e.location, '')), '') is not null
 group by e.club_id, venue_key(e.location)
on conflict (club_id, name_key) do nothing;

-- ── 2. Needs you ──────────────────────────────────────────────────────
-- Upcoming receipt-mode nights with receipts waiting to be checked.
create or replace function get_club_admin_todo(p_club_id uuid)
returns table (event_id uuid, title text, scheduled_at timestamptz, to_check int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_club_admin(p_club_id) or is_app_admin()) then
    raise exception 'Only the club''s owner and admins can see this.' using errcode = 'P0001';
  end if;
  return query
    select e.id, e.title, e.scheduled_at,
           (select count(*)::int from club_event_receipts r
              join club_event_payments p on p.event_id = r.event_id and p.user_id = r.user_id
             where r.event_id = e.id and p.paid_at is null)
      from club_events e
     where e.club_id = p_club_id and e.status = 'scheduled'
       and e.payment_mode = 'receipt'
       and e.scheduled_at > now() - interval '6 hours'
       and e.scheduled_at < now() + interval '14 days'
       and exists (select 1 from club_event_receipts r
                     join club_event_payments p on p.event_id = r.event_id and p.user_id = r.user_id
                    where r.event_id = e.id and p.paid_at is null)
     order by e.scheduled_at;
end;
$$;

-- ── 3. get_callup_extras, with the night's map link ───────────────────
create or replace function get_callup_extras(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ev club_events%rowtype;
  v_pay club_event_payments%rowtype;
  v_in int;
  v_paid int;
  v_mine record;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found then return null; end if;
  if v_uid is null or not (is_club_member(v_ev.club_id) or is_app_admin()) then
    return jsonb_build_object('member', false, 'location_url', v_ev.location_url);
  end if;
  select coalesce(sum((case when own_in then 1 else 0 end) + guests_in), 0),
         coalesce(sum(case when callup_is_paid(p_event_id, user_id) then (case when own_in then 1 else 0 end) + guests_in else 0 end), 0)
    into v_in, v_paid
    from callup_payers(p_event_id);
  select * into v_mine from callup_payers(p_event_id) where user_id = v_uid;
  select * into v_pay from club_event_payments where event_id = p_event_id and user_id = v_uid;
  return jsonb_build_object(
    'member', true,
    'notes', v_ev.notes,
    'location_url', v_ev.location_url,
    'payment_mode', v_ev.payment_mode,
    'deadline', case when v_ev.payment_mode = 'receipt' then v_ev.scheduled_at - interval '6 hours' end,
    'frozen_at', v_ev.scheduled_at - interval '1 hour',
    'in_spots', v_in,
    'paid_spots', v_paid,
    'is_admin', callup_admin(v_ev),
    'me', case when v_mine.user_id is null and v_pay.user_id is null then null else jsonb_build_object(
      'spots', coalesce((case when v_mine.own_in then 1 else 0 end) + v_mine.guests_in, 0),
      'paid', v_pay.paid_at is not null,
      'paid_at', v_pay.paid_at,
      'has_receipt', callup_has_receipt(p_event_id, v_uid),
      'receipt_at', v_pay.receipt_at,
      'rejected_reason', case when v_pay.paid_at is null and not callup_has_receipt(p_event_id, v_uid) then v_pay.rejected_reason end,
      'pay_by', case when v_pay.pay_by > now() then v_pay.pay_by end,
      'moved_unpaid', v_pay.demoted_at is not null) end
  );
end;
$$;

revoke all on function list_club_venues(uuid) from public, anon;
revoke all on function set_callup_venue(uuid, text, text, boolean) from public, anon;
revoke all on function update_club_venue(uuid, text, text) from public, anon;
revoke all on function delete_club_venue(uuid) from public, anon;
revoke all on function get_club_admin_todo(uuid) from public, anon;
revoke all on function get_callup_extras(uuid) from public, anon;
grant execute on function list_club_venues(uuid) to authenticated;
grant execute on function set_callup_venue(uuid, text, text, boolean) to authenticated;
grant execute on function update_club_venue(uuid, text, text) to authenticated;
grant execute on function delete_club_venue(uuid) to authenticated;
grant execute on function get_club_admin_todo(uuid) to authenticated;
grant execute on function get_callup_extras(uuid) to authenticated;
