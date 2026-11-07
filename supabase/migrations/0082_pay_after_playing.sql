-- ---------------------------------------------------------------------
-- 0082_pay_after_playing.sql
--
-- Paying after the night (Hamud, 7 Nov 2026). Run AFTER 0081.
--
-- Some clubs play first and pay after. Until now a Call-up dropped off the
-- club page once its session started, so there was nowhere to chase the
-- money from. Now:
--
-- 1. Once a night has been played (its session is live or ended and the
--    roster has reached the server), who owes is who PLAYED, not who said
--    "I'm in": members on the roster, guests matched by name to the member
--    who brought them, and walk-ins (no account, nobody brought them) who are
--    ticked off by name. Before the night, nothing changes.
--
-- 2. Played nights with money still to collect stay on the club page:
--    admins see "Still to collect · 5 of 8 paid", players who owe see "You
--    still owe". A night goes when everyone has paid, or when an admin taps
--    Done collecting (club_events.payments_closed_at; they can reopen it).
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

alter table club_events add column if not exists payments_closed_at timestamptz;
alter table club_events add column if not exists payments_closed_by uuid references auth.users(id) on delete set null;

-- Walk-ins: keyed by name, not by player row, so a re-synced roster keeps
-- its ticks.
create table if not exists club_event_walkin_payments (
  event_id      uuid not null references club_events(id) on delete cascade,
  name_key      text not null,
  display_name  text not null,
  paid_at       timestamptz,
  paid_by       uuid references auth.users(id) on delete set null,
  primary key (event_id, name_key)
);
alter table club_event_walkin_payments enable row level security;
revoke all on club_event_walkin_payments from anon, authenticated;
-- No policies: read and written only through the functions below.

-- ── The roster of a played night ──────────────────────────────────────
-- Who took part: anyone still on the roster, or who left after playing.
create or replace function callup_roster(p_event_id uuid)
returns table (player_id uuid, user_id uuid, display_name text, name_key text)
language sql stable security definer set search_path = public as $$
  select p.id, p.linked_user_id, btrim(p.display_name), lower(regexp_replace(btrim(p.display_name), '\s+', ' ', 'g'))
    from club_events e
    join sessions s on s.id = e.session_id and s.status in ('live', 'ended')
    join players p on p.session_id = s.id
   where e.id = p_event_id
     and (p.status <> 'left' or p.matches_played > 0)
$$;

-- Played: the session started and its roster is on the server. Until the
-- roster syncs, the RSVPs stand in for it.
create or replace function callup_played(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from callup_roster(p_event_id))
$$;

-- Each guest name on the Call-up, and who brought them.
create or replace function callup_guest_owner(p_event_id uuid)
returns table (name_key text, invited_by uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (k) k, invited_by from (
    select lower(regexp_replace(btrim(g.display_name), '\s+', ' ', 'g')) as k, g.invited_by, g.response
      from club_event_guests g
     where g.event_id = p_event_id and g.invited_by is not null
  ) x
  order by k, (response = 'in') desc
$$;

-- The members who hold at least one spot (themselves or a guest). Before the
-- night: from the answers. After it: from who played.
create or replace function callup_payers(p_event_id uuid)
returns table (user_id uuid, own_in boolean, guests_in int)
language sql stable security definer set search_path = public as $$
  with played as (select callup_played(p_event_id) as yes),
  holders as (
    select r.user_id, true as own, 0 as g from club_event_rsvps r, played
     where not played.yes and r.event_id = p_event_id and r.response = 'in'
    union all
    select g.invited_by, false, 1 from club_event_guests g, played
     where not played.yes and g.event_id = p_event_id and g.response = 'in' and g.invited_by is not null
    union all
    select ro.user_id, true, 0 from callup_roster(p_event_id) ro, played
     where played.yes and ro.user_id is not null
    union all
    select go.invited_by, false, 1 from callup_roster(p_event_id) ro
      join callup_guest_owner(p_event_id) go on go.name_key = ro.name_key, played
     where played.yes and ro.user_id is null
  )
  select user_id, bool_or(own), sum(g)::int from holders group by user_id
$$;

-- Walk-ins of a played night: on the roster with no account, and no member
-- brought anyone by that name.
create or replace function callup_walkins(p_event_id uuid)
returns table (name_key text, display_name text, paid_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (ro.name_key) ro.name_key, ro.display_name, w.paid_at
    from callup_roster(p_event_id) ro
    left join club_event_walkin_payments w on w.event_id = p_event_id and w.name_key = ro.name_key
   where ro.user_id is null
     and not exists (select 1 from callup_guest_owner(p_event_id) go where go.name_key = ro.name_key)
   order by ro.name_key
$$;

-- Spots in and spots paid, walk-ins included.
create or replace function callup_totals(p_event_id uuid, out in_spots int, out paid_spots int)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum((case when own_in then 1 else 0 end) + guests_in) from callup_payers(p_event_id)), 0)::int
      + (select count(*) from callup_walkins(p_event_id))::int,
    coalesce((select sum((case when own_in then 1 else 0 end) + guests_in) from callup_payers(p_event_id) cp
               where callup_is_paid(p_event_id, cp.user_id)), 0)::int
      + (select count(*) from callup_walkins(p_event_id) w where w.paid_at is not null)::int
$$;

-- ── What the pages read ───────────────────────────────────────────────
create or replace function get_callup_extras(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ev club_events%rowtype;
  v_pay club_event_payments%rowtype;
  v_tot record;
  v_mine record;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found then return null; end if;
  if v_uid is null or not (is_club_member(v_ev.club_id) or is_app_admin()) then
    return jsonb_build_object('member', false, 'location_url', v_ev.location_url);
  end if;
  select * into v_tot from callup_totals(p_event_id);
  select * into v_mine from callup_payers(p_event_id) where user_id = v_uid;
  select * into v_pay from club_event_payments where event_id = p_event_id and user_id = v_uid;
  return jsonb_build_object(
    'member', true,
    'notes', v_ev.notes,
    'location_url', v_ev.location_url,
    'payment_mode', v_ev.payment_mode,
    'deadline', case when v_ev.payment_mode = 'receipt' then v_ev.scheduled_at - interval '6 hours' end,
    'frozen_at', v_ev.scheduled_at - interval '1 hour',
    'in_spots', v_tot.in_spots,
    'paid_spots', v_tot.paid_spots,
    'is_admin', callup_admin(v_ev),
    'played', callup_played(p_event_id),
    'collecting_closed', v_ev.payments_closed_at is not null,
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

-- Admin: the walk-ins of a played night.
create or replace function get_callup_walkins(p_event_id uuid)
returns table (name_key text, display_name text, paid_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_ev club_events%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found or not callup_admin(v_ev) then
    raise exception 'Only the club''s owner and admins can see payments.' using errcode = 'P0001';
  end if;
  return query select w.name_key, w.display_name, w.paid_at from callup_walkins(p_event_id) w
                order by (w.paid_at is not null), w.display_name;
end;
$$;

-- Admin: tick (or untick) a walk-in.
create or replace function set_callup_walkin_payment(p_event_id uuid, p_name_key text, p_paid boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev club_events%rowtype;
  v_name text;
begin
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then raise exception 'That Call-up no longer exists.' using errcode = 'P0002'; end if;
  if not callup_admin(v_ev) then raise exception 'Only the club''s owner and admins can mark payments.' using errcode = 'P0001'; end if;
  if v_ev.payment_mode = 'none' then raise exception 'This Call-up has no payment.' using errcode = 'P0001'; end if;
  select w.display_name into v_name from callup_walkins(p_event_id) w where w.name_key = p_name_key;
  if v_name is null then raise exception 'That player isn''t on this night''s roster.' using errcode = 'P0001'; end if;
  insert into club_event_walkin_payments (event_id, name_key, display_name, paid_at, paid_by)
  values (p_event_id, p_name_key, v_name, case when p_paid then now() end, case when p_paid then auth.uid() end)
  on conflict (event_id, name_key) do update
    set paid_at = excluded.paid_at, paid_by = excluded.paid_by, display_name = excluded.display_name;
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin: Done collecting, or reopen.
create or replace function set_callup_collecting(p_event_id uuid, p_done boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev club_events%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then raise exception 'That Call-up no longer exists.' using errcode = 'P0002'; end if;
  if not callup_admin(v_ev) then raise exception 'Only the club''s owner and admins can change this.' using errcode = 'P0001'; end if;
  update club_events
     set payments_closed_at = case when p_done then now() end,
         payments_closed_by = case when p_done then auth.uid() end
   where id = p_event_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- The club page: played nights with money still out. Admins get "collect",
-- everyone gets their own "owe".
create or replace function get_club_money(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean;
  v_collect jsonb := '[]'::jsonb;
  v_owe jsonb := '[]'::jsonb;
  e record;
  t record;
  m record;
begin
  if v_uid is null or not (is_club_member(p_club_id) or is_app_admin()) then
    raise exception 'Only members can see this.' using errcode = 'P0001';
  end if;
  v_admin := is_club_admin(p_club_id) or is_app_admin();
  for e in
    select * from club_events
     where club_id = p_club_id and status = 'scheduled' and payment_mode <> 'none'
       and payments_closed_at is null and session_id is not null
     order by scheduled_at
  loop
    continue when not callup_played(e.id);
    select * into t from callup_totals(e.id);
    if v_admin and t.paid_spots < t.in_spots then
      v_collect := v_collect || jsonb_build_object(
        'event_id', e.id, 'slug', e.slug, 'title', e.title, 'scheduled_at', e.scheduled_at,
        'in_spots', t.in_spots, 'paid_spots', t.paid_spots,
        'to_check', (select count(*) from club_event_receipts r
                       join club_event_payments p on p.event_id = r.event_id and p.user_id = r.user_id
                      where r.event_id = e.id and p.paid_at is null));
    end if;
    select * into m from callup_payers(e.id) where user_id = v_uid;
    if m.user_id is not null and not callup_is_paid(e.id, v_uid) then
      v_owe := v_owe || jsonb_build_object(
        'event_id', e.id, 'slug', e.slug, 'title', e.title, 'scheduled_at', e.scheduled_at,
        'cost', e.cost, 'payment_mode', e.payment_mode,
        'spots', (case when m.own_in then 1 else 0 end) + m.guests_in,
        'has_receipt', callup_has_receipt(e.id, v_uid));
    end if;
  end loop;
  return jsonb_build_object('collect', v_collect, 'owe', v_owe);
end;
$$;

revoke all on function get_callup_extras(uuid) from public, anon;
revoke all on function get_callup_walkins(uuid) from public, anon;
revoke all on function set_callup_walkin_payment(uuid, text, boolean) from public, anon;
revoke all on function set_callup_collecting(uuid, boolean) from public, anon;
revoke all on function get_club_money(uuid) from public, anon;
grant execute on function get_callup_extras(uuid) to authenticated;
grant execute on function get_callup_walkins(uuid) to authenticated;
grant execute on function set_callup_walkin_payment(uuid, text, boolean) to authenticated;
grant execute on function set_callup_collecting(uuid, boolean) to authenticated;
grant execute on function get_club_money(uuid) to authenticated;
-- Internals stay internal.
revoke all on function callup_payers(uuid) from public, anon, authenticated;
revoke all on function callup_roster(uuid) from public, anon, authenticated;
revoke all on function callup_played(uuid) from public, anon, authenticated;
revoke all on function callup_guest_owner(uuid) from public, anon, authenticated;
revoke all on function callup_walkins(uuid) from public, anon, authenticated;
revoke all on function callup_totals(uuid) from public, anon, authenticated;
