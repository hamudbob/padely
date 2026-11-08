-- ---------------------------------------------------------------------
-- 0085_guests_pay_for_themselves.sql
--
-- Each guest pays for their own spot (Hamud, 9 Nov 2026). Run AFTER 0084.
--
-- Until now a member's payment covered the guests they brought ("Gilang +2
-- guests · Paid"), so ticking Gilang ticked two people who hadn't paid. Now:
--
--   * Every guest has their own payment: paid, receipt, rejected, their own
--     hour and their own deadline. The admin's Payments list names each one
--     ("Rina · guest of Gilang").
--   * Whoever brought a guest uploads that guest's receipt from the Call-up,
--     one per guest, and is told about it.
--   * Receipt needed: a guest without a receipt at the deadline moves to the
--     waiting list on their own; the member who brought them keeps their spot.
--   * Pay to get in: an accepted guest receipt is what moves that guest in.
--   * After the night, guests who played and haven't paid count in "Still to
--     collect", and in "You still owe" for whoever brought them.
--
-- Guests already on an upcoming Call-up when this runs start unpaid, but are
-- not moved by a deadline: only guests added from now on are.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

create table if not exists club_event_guest_payments (
  guest_id          uuid primary key references club_event_guests(id) on delete cascade,
  event_id          uuid not null references club_events(id) on delete cascade,
  paid_at           timestamptz,
  paid_by           uuid references auth.users(id) on delete set null,
  receipt           bytea,
  receipt_mime      text,
  receipt_at        timestamptz,
  rejected_at       timestamptz,
  rejected_reason   text,
  pay_by            timestamptz,
  demoted_at        timestamptz,
  deadline_applies  boolean not null default true
);
create index if not exists club_event_guest_payments_event on club_event_guest_payments (event_id);
alter table club_event_guest_payments enable row level security;
revoke all on club_event_guest_payments from anon, authenticated;
-- No policies: read and written only through the functions below.

-- Guests already on upcoming Call-ups: unpaid, but no deadline moves them.
insert into club_event_guest_payments (guest_id, event_id, deadline_applies)
select g.id, g.event_id, false
  from club_event_guests g join club_events e on e.id = g.event_id
 where e.status = 'scheduled' and e.scheduled_at > now()
on conflict (guest_id) do nothing;

create or replace function guest_is_paid(p_guest uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_event_guest_payments where guest_id = p_guest and paid_at is not null)
$$;
create or replace function guest_has_receipt(p_guest uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_event_guest_payments where guest_id = p_guest and receipt is not null)
$$;

-- The guests who hold a spot to pay for. Before the night: guests who are in.
-- After it (0082): guests on the roster, matched by name.
create or replace function callup_guest_payers(p_event_id uuid)
returns table (guest_id uuid, display_name text, invited_by uuid)
language sql stable security definer set search_path = public as $$
  select g.id, g.display_name, g.invited_by from club_event_guests g
   where g.event_id = p_event_id and g.response = 'in' and not callup_played(p_event_id)
  union all
  select x.id, x.display_name, x.invited_by from (
    select distinct on (lower(regexp_replace(btrim(g.display_name), '\s+', ' ', 'g')))
           g.id, g.display_name, g.invited_by
      from club_event_guests g
      join callup_roster(p_event_id) ro
        on ro.user_id is null and ro.name_key = lower(regexp_replace(btrim(g.display_name), '\s+', ' ', 'g'))
     where g.event_id = p_event_id and g.invited_by is not null and callup_played(p_event_id)
     order by lower(regexp_replace(btrim(g.display_name), '\s+', ' ', 'g')), (g.response = 'in') desc
  ) x
$$;

-- Members' own spots only: guests are paid for on their own now.
create or replace function callup_payers(p_event_id uuid)
returns table (user_id uuid, own_in boolean, guests_in int)
language sql stable security definer set search_path = public as $$
  select r.user_id, true, 0 from club_event_rsvps r
   where not callup_played(p_event_id) and r.event_id = p_event_id and r.response = 'in'
  union
  select ro.user_id, true, 0 from callup_roster(p_event_id) ro
   where callup_played(p_event_id) and ro.user_id is not null
$$;

create or replace function callup_totals(p_event_id uuid, out in_spots int, out paid_spots int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from callup_payers(p_event_id))::int
      + (select count(*) from callup_guest_payers(p_event_id))::int
      + (select count(*) from callup_walkins(p_event_id))::int,
    (select count(*) from callup_payers(p_event_id) cp where callup_is_paid(p_event_id, cp.user_id))::int
      + (select count(*) from callup_guest_payers(p_event_id) gp where guest_is_paid(gp.guest_id))::int
      + (select count(*) from callup_walkins(p_event_id) w where w.paid_at is not null)::int
$$;

-- Pay to get in: one spot per receipt now.
create or replace function callup_my_waiting_spots(p_event_id uuid, p_user uuid) returns int
language sql stable as $$ select 1 $$;

-- Receipts waiting to be checked from the waiting list (Pay to get in), in
-- the order they arrived: members and guests in one line.
create or replace function callup_pending_queue(p_event_id uuid)
returns table (kind text, ref uuid, receipt_at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'member', r.user_id, p.receipt_at
    from club_event_rsvps r join club_event_payments p on p.event_id = r.event_id and p.user_id = r.user_id
   where r.event_id = p_event_id and r.response = 'waitlist' and p.paid_at is null
     and callup_has_receipt(p_event_id, r.user_id)
  union all
  select 'guest', g.id, gp.receipt_at
    from club_event_guests g join club_event_guest_payments gp on gp.guest_id = g.id
   where g.event_id = p_event_id and g.response = 'waitlist' and gp.paid_at is null and gp.receipt is not null
$$;

create or replace function callup_pending_spots(p_event_id uuid, p_except uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from callup_pending_queue(p_event_id) q
   where not (q.kind = 'member' and q.ref is not distinct from p_except)
$$;


create or replace function callup_demote(p_ev club_events, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update club_event_rsvps set response = 'waitlist', responded_at = now()
   where event_id = p_ev.id and user_id = p_user and response = 'in';
  insert into club_event_payments (event_id, user_id, demoted_at) values (p_ev.id, p_user, now())
  on conflict (event_id, user_id) do update set pay_by = null, demoted_at = now();
  insert into notifications (user_id, type, title, body, data)
  values (p_user, 'callup_moved_unpaid',
    'Moved to the waiting list: ' || p_ev.title,
    'Your spot wasn''t paid in time, so it went to the next person. If a spot opens up, answer I''m in again to take it (you''ll have 1 hour to pay).',
    jsonb_build_object('event_id', p_ev.id, 'club_id', p_ev.club_id));
end;
$$;

-- A guest's own move down, told to whoever brought them.
create or replace function callup_demote_guest(p_ev club_events, p_guest uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g club_event_guests%rowtype;
begin
  select * into v_g from club_event_guests where id = p_guest;
  if not found then return; end if;
  update club_event_guests set response = 'waitlist', created_at = now() where id = p_guest and response = 'in';
  insert into club_event_guest_payments (guest_id, event_id, demoted_at) values (p_guest, p_ev.id, now())
  on conflict (guest_id) do update set pay_by = null, demoted_at = now();
  if v_g.invited_by is not null then
    insert into notifications (user_id, type, title, body, data)
    values (v_g.invited_by, 'callup_moved_unpaid',
      v_g.display_name || ' moved to the waiting list',
      p_ev.title || ': no receipt for ' || v_g.display_name || ' arrived in time, so the spot went to the next person.',
      jsonb_build_object('event_id', p_ev.id, 'club_id', p_ev.club_id));
  end if;
end;
$$;

-- A guest's own hour, when they take a spot after the deadline.
create or replace function callup_start_guest_window(p_guest uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_g club_event_guests%rowtype;
  v_ev club_events%rowtype;
  v_end timestamptz;
begin
  select * into v_g from club_event_guests where id = p_guest;
  if not found then return null; end if;
  select * into v_ev from club_events where id = v_g.event_id;
  if not found or not callup_window_applies(v_ev) then return null; end if;
  if guest_is_paid(p_guest) or guest_has_receipt(p_guest) then return null; end if;
  v_end := pay_window_end(now());
  insert into club_event_guest_payments (guest_id, event_id, pay_by) values (p_guest, v_g.event_id, v_end)
  on conflict (guest_id) do update set pay_by = excluded.pay_by, demoted_at = null;
  return v_end;
end;
$$;


create or replace function trg_callup_spot_taken() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payer uuid;
  v_end timestamptz;
  v_ev club_events%rowtype;
begin
  if new.response <> 'in' then return new; end if;
  if TG_OP = 'UPDATE' and old.response = 'in' then return new; end if;
  -- 0085: a guest's spot is the guest's to pay for.
  if TG_TABLE_NAME = 'club_event_guests' then
    if new.invited_by is null then return new; end if;
    update club_event_guest_payments set demoted_at = null where guest_id = new.id and demoted_at is not null;
    v_end := callup_start_guest_window(new.id);
    if v_end is not null and coalesce(current_setting('padelier.promoting', true), '') <> '1' then
      select * into v_ev from club_events where id = new.event_id;
      insert into notifications (user_id, type, title, body, data)
      values (new.invited_by, 'callup_pay',
        'Pay for ' || new.display_name || ' to keep their spot',
        v_ev.title || ': upload ' || new.display_name || '''s receipt within 1 hour (by ' ||
          to_char(v_end at time zone 'Asia/Jakarta', 'HH24:MI') || '), or the spot goes to the next person.',
        jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id));
    end if;
    return new;
  end if;
  v_payer := new.user_id;
  if v_payer is null then return new; end if;

  update club_event_payments set demoted_at = null
   where event_id = new.event_id and user_id = v_payer and demoted_at is not null;
  v_end := callup_start_window(new.event_id, v_payer);
  if v_end is not null and coalesce(current_setting('padelier.promoting', true), '') <> '1' then
    select * into v_ev from club_events where id = new.event_id;
    insert into notifications (user_id, type, title, body, data)
    values (v_payer, 'callup_pay',
      'Pay now to keep your spot',
      v_ev.title || ': pay within 1 hour (by ' || to_char(v_end at time zone 'Asia/Jakarta', 'HH24:MI') ||
        ') and upload the receipt, or the spot goes to the next person.',
      jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id));
  end if;
  return new;
end;
$$;

create or replace function promote_next_waitlister(p_event_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_next uuid;
  v_ev   club_events%rowtype;
  v_kind text;
  v_ref  uuid;
  v_guest club_event_guests%rowtype;
  v_payer uuid;
  v_end  timestamptz;
  v_pay  text;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found or v_ev.max_players is null then return null; end if;
  -- 0084: Pay to get in. Nobody is moved up for free: a spot opening is
  -- news for the people waiting, and the first receipt to be accepted gets it.
  if v_ev.payment_mode = 'prepay' then
    if event_in_count(p_event_id) + callup_pending_spots(p_event_id, null) < v_ev.max_players then
      insert into notifications (user_id, type, title, body, data)
      select distinct w.user_id, 'callup_spot_open', 'A spot opened: ' || v_ev.title,
             'Upload a transfer receipt to ask for it. Receipts are checked in the order they arrive.',
             jsonb_build_object('event_id', p_event_id, 'club_id', v_ev.club_id)
        from (
          select r.user_id from club_event_rsvps r
           where r.event_id = p_event_id and r.response = 'waitlist' and not callup_has_receipt(p_event_id, r.user_id)
          union
          select g.invited_by from club_event_guests g
           where g.event_id = p_event_id and g.response = 'waitlist' and g.invited_by is not null and not guest_has_receipt(g.id)
        ) w;
    end if;
    return null;
  end if;
  -- Only if a slot actually opened. Counts guests now.
  if event_in_count(p_event_id) >= v_ev.max_players then
    return null;
  end if;

  -- The earliest waiter, member or guest. The queue is a queue.
  select kind, ref into v_kind, v_ref from (
    select 'member' as kind, r.user_id as ref, r.responded_at as at
      from club_event_rsvps r where r.event_id = p_event_id and r.response = 'waitlist'
       and not exists (select 1 from club_event_payments d
                        where d.event_id = p_event_id and d.user_id = r.user_id and d.demoted_at is not null)
    union all
    select 'guest' as kind, g.id as ref, g.created_at as at
      from club_event_guests g where g.event_id = p_event_id and g.response = 'waitlist'
       and not exists (select 1 from club_event_guest_payments d where d.guest_id = g.id and d.demoted_at is not null)
  ) q order by q.at asc limit 1;
  if v_kind is null then return null; end if;

  perform set_config('padelier.promoting', '1', true);
  if v_kind = 'guest' then
    update club_event_guests set response = 'in' where id = v_ref;
    select * into v_guest from club_event_guests where id = v_ref;
    v_payer := v_guest.invited_by;
  else
    v_next := v_ref;
    update club_event_rsvps set response = 'in' where event_id = p_event_id and user_id = v_next;
    v_payer := v_next;
  end if;
  perform set_config('padelier.promoting', '0', true);

  -- 0080: the hour to pay, in the same message.
  if v_kind = 'guest' then
    select pay_by into v_end from club_event_guest_payments where guest_id = v_ref and callup_window_applies(v_ev);
  else
    select pay_by into v_end from club_event_payments
     where event_id = p_event_id and user_id = v_payer and callup_window_applies(v_ev);
  end if;
  v_pay := case when v_end is not null
    then ' Pay within 1 hour (by ' || to_char(v_end at time zone 'Asia/Jakarta', 'HH24:MI') ||
         ') and upload the receipt to keep it.'
    else '' end;

  if v_kind = 'guest' then
    -- A guest has no account, so the news goes to whoever brought them.
    if v_guest.invited_by is not null then
      insert into notifications (user_id, type, title, body, data)
      values (
        v_guest.invited_by, 'event_promoted',
        v_guest.display_name || ' is in for ' || v_ev.title,
        'A place opened up for your guest. ' || to_char(v_ev.scheduled_at at time zone 'Asia/Jakarta', 'Dy DD Mon at HH24:MI') ||
          coalesce(' · ' || v_ev.location, '') || '.' || v_pay,
        jsonb_build_object('event_id', p_event_id, 'club_id', v_ev.club_id)
      );
    end if;
    -- Deliberately null: the caller's contract is "which USER was promoted".
    return null;
  end if;

  insert into notifications (user_id, type, title, body, data)
  values (
    v_next, 'event_promoted',
    'You''re in for ' || v_ev.title,
    'A place opened up. ' || to_char(v_ev.scheduled_at at time zone 'Asia/Jakarta', 'Dy DD Mon at HH24:MI') ||
      coalesce(' · ' || v_ev.location, '') || '.' || v_pay,
    jsonb_build_object('event_id', p_event_id, 'club_id', v_ev.club_id)
  );
  return v_next;
end;
$$;

create or replace function process_callup_payments() returns integer
language plpgsql security definer set search_path = public as $$
declare
  ev  club_events%rowtype;
  p   record;
  v_d timestamptz;
  v_moved int := 0;
  v_guard int;
  v_before int;
begin
  for ev in
    select * from club_events
     where payment_mode = 'receipt' and status = 'scheduled'
       and scheduled_at > now() + interval '1 hour'      -- the freeze
       and scheduled_at < now() + interval '25 hours'
     for update skip locked
  loop
    v_d := ev.scheduled_at - interval '6 hours';

    -- Reminders, in daytime only.
    if ev.pay_reminded_24_at is null and now() < v_d - interval '1 hour' and jakarta_daytime(now()) then
      update club_events set pay_reminded_24_at = now() where id = ev.id;
      insert into notifications (user_id, type, title, body, data)
      select cp.user_id, 'callup_pay_reminder', 'Pay for ' || ev.title,
             'Pay and upload the receipt by ' || to_char(v_d at time zone 'Asia/Jakarta', 'Dy HH24:MI') ||
             ' to keep your spot. Unpaid spots go to the waiting list then.',
             jsonb_build_object('event_id', ev.id, 'club_id', ev.club_id)
        from callup_payers(ev.id) cp
       where not callup_is_paid(ev.id, cp.user_id) and not callup_has_receipt(ev.id, cp.user_id);
    end if;
    if ev.pay_reminded_last_at is null and now() >= v_d - interval '1 hour' and now() < v_d and jakarta_daytime(now()) then
      update club_events set pay_reminded_last_at = now(), pay_reminded_24_at = coalesce(pay_reminded_24_at, now()) where id = ev.id;
      insert into notifications (user_id, type, title, body, data)
      select cp.user_id, 'callup_pay_reminder', '1 hour left to pay: ' || ev.title,
             'Upload the receipt by ' || to_char(v_d at time zone 'Asia/Jakarta', 'HH24:MI') ||
             ' or your spot goes to the waiting list.',
             jsonb_build_object('event_id', ev.id, 'club_id', ev.club_id)
        from callup_payers(ev.id) cp
       where not callup_is_paid(ev.id, cp.user_id) and not callup_has_receipt(ev.id, cp.user_id);
    end if;
    -- 0085: and whoever brought an unpaid guest, about that guest.
    if now() >= v_d - interval '1 hour' and now() < v_d and jakarta_daytime(now())
       and ev.pay_reminded_last_at is not null and ev.pay_reminded_last_at > now() - interval '6 minutes' then
      insert into notifications (user_id, type, title, body, data)
      select gp.invited_by, 'callup_pay_reminder', '1 hour left to pay for ' || gp.display_name,
             ev.title || ': upload ' || gp.display_name || '''s receipt by ' || to_char(v_d at time zone 'Asia/Jakarta', 'HH24:MI') ||
             ' or their spot goes to the waiting list.',
             jsonb_build_object('event_id', ev.id, 'club_id', ev.club_id)
        from callup_guest_payers(ev.id) gp
       where gp.invited_by is not null and not guest_is_paid(gp.guest_id) and not guest_has_receipt(gp.guest_id);
    end if;

    continue when now() < v_d;

    -- The deadline, and every personal hour that has run out since.
    if ev.pay_deadline_done_at is null then
      update club_events set pay_deadline_done_at = now() where id = ev.id;
    end if;
    for p in
      select cp.user_id from callup_payers(ev.id) cp
        left join club_event_payments pay on pay.event_id = ev.id and pay.user_id = cp.user_id
       where pay.paid_at is null
         and not callup_has_receipt(ev.id, cp.user_id)
         and (pay.pay_by is null or pay.pay_by <= now())
    loop
      perform callup_demote(ev, p.user_id);
      v_moved := v_moved + 1;
    end loop;
    -- 0085: each guest on their own.
    for p in
      select gp.guest_id from callup_guest_payers(ev.id) gp
        left join club_event_guest_payments pay on pay.guest_id = gp.guest_id
       where coalesce(pay.deadline_applies, true)
         and pay.paid_at is null and pay.receipt is null
         and (pay.pay_by is null or pay.pay_by <= now())
    loop
      perform callup_demote_guest(ev, p.guest_id);
      v_moved := v_moved + 1;
    end loop;

    -- Fill what opened up, in queue order (each one gets their hour).
    v_guard := 0;
    while v_guard < 100 and event_in_count(ev.id) < coalesce(ev.max_players, 0) loop
      v_before := event_in_count(ev.id);
      perform promote_next_waitlister(ev.id);
      exit when event_in_count(ev.id) = v_before;   -- nobody left to move up
      v_guard := v_guard + 1;
    end loop;
  end loop;

  -- Receipts go 3 days after the night (or the Call-up's date, if it never
  -- became a session).
  delete from club_event_receipts r
   using club_events e
   where e.id = r.event_id
     and coalesce((select s.ended_at from sessions s where s.id = e.session_id), e.scheduled_at)
         < now() - interval '3 days';
  update club_event_guest_payments gp set receipt = null, receipt_mime = null
    from club_events e
   where e.id = gp.event_id and gp.receipt is not null
     and coalesce((select s.ended_at from sessions s where s.id = e.session_id), e.scheduled_at)
         < now() - interval '3 days';

  return v_moved;
end;
$$;

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
    -- 0084: Pay to get in.
    'pending_spots', callup_pending_spots(p_event_id, null),
    'upload_open', v_ev.payment_mode = 'prepay' and (v_ev.max_players is null
       or callup_has_receipt(p_event_id, v_uid)
       or v_ev.max_players - event_in_count(p_event_id) - callup_pending_spots(p_event_id, v_uid)
          >= greatest(callup_my_waiting_spots(p_event_id, v_uid), 1)),
    'check_position', case when v_ev.payment_mode = 'prepay' and callup_has_receipt(p_event_id, v_uid) and v_pay.paid_at is null then (
       select count(*) from callup_pending_queue(p_event_id) q where q.receipt_at <= v_pay.receipt_at) end,
    -- 0085: the guests I brought, each with their own payment.
    'my_guests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.display_name, 'response', g.response,
        'paid', gp.paid_at is not null, 'paid_at', gp.paid_at,
        'has_receipt', gp.receipt is not null, 'receipt_at', gp.receipt_at,
        'rejected_reason', case when gp.paid_at is null and gp.receipt is null then gp.rejected_reason end,
        'pay_by', case when gp.pay_by > now() then gp.pay_by end,
        'moved_unpaid', gp.demoted_at is not null,
        'played', exists (select 1 from callup_guest_payers(p_event_id) x where x.guest_id = g.id),
        'check_position', case when v_ev.payment_mode = 'prepay' and g.response = 'waitlist' and gp.receipt is not null and gp.paid_at is null then
          (select count(*) from callup_pending_queue(p_event_id) q where q.receipt_at <= gp.receipt_at) end
      ) order by g.created_at), '[]'::jsonb)
        from club_event_guests g left join club_event_guest_payments gp on gp.guest_id = g.id
       where g.event_id = p_event_id and g.invited_by = v_uid),
    'me', case when v_mine.user_id is null and v_pay.user_id is null then null else jsonb_build_object(
      'spots', case when v_mine.own_in then 1 else 0 end,
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

create or replace function set_callup_payment(p_event_id uuid, p_user_id uuid, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev club_events%rowtype;
  v_end timestamptz;
  v_room int;
  g record;
begin
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then raise exception 'That Call-up no longer exists.' using errcode = 'P0002'; end if;
  if not callup_admin(v_ev) then raise exception 'Only the club''s owner and admins can mark payments.' using errcode = 'P0001'; end if;
  if v_ev.payment_mode = 'none' then raise exception 'This Call-up has no payment.' using errcode = 'P0001'; end if;

  -- 0084: Pay to get in. Accepting moves the payer in, with any guests they
  -- have waiting, as far as the spots go.
  if p_action = 'paid' and v_ev.payment_mode = 'prepay'
     and exists (select 1 from club_event_rsvps where event_id = p_event_id and user_id = p_user_id and response = 'waitlist') then
    v_room := case when v_ev.max_players is null then 1000 else v_ev.max_players - event_in_count(p_event_id) end;
    if v_room < 1 then
      raise exception 'Every spot is already taken. Take someone out first, or reject this receipt.' using errcode = 'P0001';
    end if;
    update club_event_rsvps set response = 'in' where event_id = p_event_id and user_id = p_user_id;
    insert into notifications (user_id, type, title, body, data)
    values (p_user_id, 'event_promoted', 'You''re in for ' || v_ev.title,
      'Your receipt was accepted. ' || to_char(v_ev.scheduled_at at time zone 'Asia/Jakarta', 'Dy DD Mon at HH24:MI') ||
        coalesce(' · ' || v_ev.location, '') || '.',
      jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id));
  end if;

  if p_action = 'paid' then
    insert into club_event_payments (event_id, user_id, paid_at, paid_by) values (p_event_id, p_user_id, now(), auth.uid())
    on conflict (event_id, user_id) do update set paid_at = now(), paid_by = auth.uid(), rejected_at = null, rejected_reason = null, pay_by = null, demoted_at = null;
  elsif p_action = 'unpaid' then
    update club_event_payments set paid_at = null, paid_by = null where event_id = p_event_id and user_id = p_user_id;
  elsif p_action = 'reject' then
    if char_length(coalesce(p_reason, '')) > 200 then raise exception 'Keep the reason short.' using errcode = 'P0001'; end if;
    delete from club_event_receipts where event_id = p_event_id and user_id = p_user_id;
    insert into club_event_payments (event_id, user_id, rejected_at, rejected_reason) values (p_event_id, p_user_id, now(), nullif(btrim(p_reason), ''))
    on conflict (event_id, user_id) do update set paid_at = null, paid_by = null, rejected_at = now(), rejected_reason = nullif(btrim(p_reason), '');
    -- Past the deadline: an hour to try again.
    v_end := callup_start_window(p_event_id, p_user_id);
    insert into notifications (user_id, type, title, body, data)
    values (p_user_id, 'callup_receipt_rejected', 'Receipt not accepted: ' || v_ev.title,
      coalesce(nullif(btrim(p_reason), '') || '. ', '') ||
      case when v_end is not null then 'Upload a new one by ' || to_char(v_end at time zone 'Asia/Jakarta', 'HH24:MI') || ' to keep your spot.'
           else 'Upload a new one from the Call-up.' end,
      jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id));
  else
    raise exception 'Unknown action.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin: every guest with a spot to pay for (or paid, or asking to get in).
create or replace function get_callup_guest_payments(p_event_id uuid)
returns table (guest_id uuid, display_name text, invited_by uuid, invited_by_name text, response text,
               paid_at timestamptz, has_receipt boolean, receipt_at timestamptz, rejected_reason text, pay_by timestamptz,
               holds_spot boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_ev club_events%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found or not callup_admin(v_ev) then
    raise exception 'Only the club''s owner and admins can see payments.' using errcode = 'P0001';
  end if;
  return query
    select g.id, g.display_name, g.invited_by, pr.display_name, g.response,
           gp.paid_at, gp.receipt is not null, gp.receipt_at,
           case when gp.paid_at is null and gp.receipt is null then gp.rejected_reason end,
           case when gp.pay_by > now() then gp.pay_by end,
           exists (select 1 from callup_guest_payers(p_event_id) x where x.guest_id = g.id)
      from club_event_guests g
      left join club_event_guest_payments gp on gp.guest_id = g.id
      left join profiles pr on pr.id = g.invited_by
     where g.event_id = p_event_id
       and (exists (select 1 from callup_guest_payers(p_event_id) x where x.guest_id = g.id)
            or gp.paid_at is not null
            or (g.response = 'waitlist' and gp.receipt is not null and v_ev.payment_mode = 'prepay'))
     order by (gp.paid_at is not null), (gp.receipt is not null) desc, gp.receipt_at asc nulls last, g.display_name;
end;
$$;

-- The member who brought a guest: upload (or replace) that guest's receipt.
create or replace function upload_guest_receipt(p_guest_id uuid, p_image_base64 text, p_mime text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_g club_event_guests%rowtype;
  v_ev club_events%rowtype;
  v_img bytea;
  v_room int;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = 'P0001'; end if;
  select * into v_g from club_event_guests where id = p_guest_id;
  if not found then raise exception 'That guest is no longer on this Call-up.' using errcode = 'P0002'; end if;
  if v_g.invited_by is distinct from v_uid then
    raise exception 'Only the member who brought this guest can upload their receipt.' using errcode = 'P0001';
  end if;
  select * into v_ev from club_events where id = v_g.event_id for update;
  if v_ev.status <> 'scheduled' then raise exception 'That Call-up isn''t open.' using errcode = 'P0001'; end if;
  if v_ev.payment_mode not in ('receipt', 'prepay') then raise exception 'This Call-up doesn''t take receipts.' using errcode = 'P0001'; end if;
  if guest_is_paid(p_guest_id) then raise exception '% is already marked as paid.', v_g.display_name using errcode = 'P0001'; end if;
  if v_ev.payment_mode = 'prepay' then
    if v_g.response not in ('waitlist', 'in') then raise exception 'That guest isn''t on the list.' using errcode = 'P0001'; end if;
    if v_g.response = 'waitlist' and v_ev.max_players is not null and not guest_has_receipt(p_guest_id) then
      v_room := v_ev.max_players - event_in_count(v_ev.id) - callup_pending_spots(v_ev.id, null);
      if v_room < 1 then
        raise exception 'Every spot is taken or being checked. If one frees up you''ll be told.' using errcode = 'P0001';
      end if;
    end if;
  elsif not exists (select 1 from callup_guest_payers(v_ev.id) x where x.guest_id = p_guest_id) then
    raise exception 'Only guests who are in can have a receipt.' using errcode = 'P0001';
  end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Upload a photo or screenshot.' using errcode = 'P0001'; end if;
  begin
    v_img := decode(p_image_base64, 'base64');
  exception when others then
    raise exception 'That image couldn''t be read.' using errcode = 'P0001';
  end;
  if length(v_img) > 900000 then raise exception 'That image is too large.' using errcode = 'P0001'; end if;

  insert into club_event_guest_payments (guest_id, event_id, receipt, receipt_mime, receipt_at)
  values (p_guest_id, v_ev.id, v_img, p_mime, clock_timestamp())
  on conflict (guest_id) do update
    set receipt = excluded.receipt, receipt_mime = excluded.receipt_mime,
        receipt_at = case when v_ev.payment_mode = 'prepay' and club_event_guest_payments.receipt is not null
                          then club_event_guest_payments.receipt_at else clock_timestamp() end,
        rejected_at = null, rejected_reason = null;
  return get_callup_extras(v_ev.id);
end;
$$;

-- The member who brought the guest, or the club's admins: the receipt image.
create or replace function get_guest_receipt(p_guest_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_g club_event_guests%rowtype;
  v_ev club_events%rowtype;
  v_p club_event_guest_payments%rowtype;
begin
  select * into v_g from club_event_guests where id = p_guest_id;
  if not found then return null; end if;
  select * into v_ev from club_events where id = v_g.event_id;
  if not (auth.uid() = v_g.invited_by or callup_admin(v_ev)) then
    raise exception 'Only the club''s owner and admins can see receipts.' using errcode = 'P0001';
  end if;
  select * into v_p from club_event_guest_payments where guest_id = p_guest_id;
  if not found or v_p.receipt is null then return null; end if;
  return jsonb_build_object('mime', v_p.receipt_mime, 'image', encode(v_p.receipt, 'base64'), 'uploaded_at', v_p.receipt_at);
end;
$$;

-- Admin: a guest paid / not paid / receipt rejected.
create or replace function set_guest_payment(p_guest_id uuid, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_g club_event_guests%rowtype;
  v_ev club_events%rowtype;
  v_end timestamptz;
begin
  select * into v_g from club_event_guests where id = p_guest_id;
  if not found then raise exception 'That guest is no longer on this Call-up.' using errcode = 'P0002'; end if;
  select * into v_ev from club_events where id = v_g.event_id for update;
  if not callup_admin(v_ev) then raise exception 'Only the club''s owner and admins can mark payments.' using errcode = 'P0001'; end if;
  if v_ev.payment_mode = 'none' then raise exception 'This Call-up has no payment.' using errcode = 'P0001'; end if;

  if p_action = 'paid' then
    -- Pay to get in: accepting is what lets the guest in.
    if v_ev.payment_mode = 'prepay' and v_g.response = 'waitlist' then
      if v_ev.max_players is not null and event_in_count(v_ev.id) >= v_ev.max_players then
        raise exception 'Every spot is already taken. Take someone out first, or reject this receipt.' using errcode = 'P0001';
      end if;
      update club_event_guests set response = 'in' where id = p_guest_id;
      if v_g.invited_by is not null then
        insert into notifications (user_id, type, title, body, data)
        values (v_g.invited_by, 'event_promoted', v_g.display_name || ' is in for ' || v_ev.title,
          'Their receipt was accepted. ' || to_char(v_ev.scheduled_at at time zone 'Asia/Jakarta', 'Dy DD Mon at HH24:MI') ||
            coalesce(' · ' || v_ev.location, '') || '.',
          jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id));
      end if;
    end if;
    insert into club_event_guest_payments (guest_id, event_id, paid_at, paid_by) values (p_guest_id, v_ev.id, now(), auth.uid())
    on conflict (guest_id) do update set paid_at = now(), paid_by = auth.uid(), rejected_at = null, rejected_reason = null, pay_by = null, demoted_at = null;
  elsif p_action = 'unpaid' then
    update club_event_guest_payments set paid_at = null, paid_by = null where guest_id = p_guest_id;
  elsif p_action = 'reject' then
    if char_length(coalesce(p_reason, '')) > 200 then raise exception 'Keep the reason short.' using errcode = 'P0001'; end if;
    insert into club_event_guest_payments (guest_id, event_id, rejected_at, rejected_reason) values (p_guest_id, v_ev.id, now(), nullif(btrim(p_reason), ''))
    on conflict (guest_id) do update set paid_at = null, paid_by = null, receipt = null, receipt_mime = null,
      rejected_at = now(), rejected_reason = nullif(btrim(p_reason), '');
    v_end := callup_start_guest_window(p_guest_id);
    if v_g.invited_by is not null then
      insert into notifications (user_id, type, title, body, data)
      values (v_g.invited_by, 'callup_receipt_rejected', 'Receipt for ' || v_g.display_name || ' not accepted',
        coalesce(nullif(btrim(p_reason), '') || '. ', '') ||
        case when v_end is not null then 'Upload a new one by ' || to_char(v_end at time zone 'Asia/Jakarta', 'HH24:MI') || ' to keep their spot.'
             else 'Upload a new one from the Call-up.' end,
        jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id));
    end if;
  else
    raise exception 'Unknown action.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- A paid guest taken off: the admins should know (refunds are theirs).
create or replace function trg_guest_paid_removed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ev club_events%rowtype;
begin
  if guest_is_paid(old.id) then
    select * into v_ev from club_events where id = old.event_id;
    insert into notifications (user_id, type, title, body, data)
    select cm.user_id, 'callup_paid_left', old.display_name || ' (a guest) paid but was taken off',
           v_ev.title || ': they had paid. Sort out a refund if your club does them.',
           jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id)
      from club_members cm
     where cm.club_id = v_ev.club_id and cm.role in ('owner', 'admin');
  end if;
  return old;
end;
$$;
drop trigger if exists guest_paid_removed on club_event_guests;
create trigger guest_paid_removed before delete on club_event_guests
  for each row execute function trg_guest_paid_removed();


create or replace function trg_callup_cancelled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'cancelled' and new.status = 'cancelled' and new.payment_mode <> 'none' then
    insert into notifications (user_id, type, title, body, data)
    select p.user_id, 'callup_cancelled_paid', new.title || ' was cancelled',
           'You had paid for it. Ask the club''s admin about your refund.',
           jsonb_build_object('event_id', new.id, 'club_id', new.club_id)
      from club_event_payments p where p.event_id = new.id and p.paid_at is not null;
    -- 0085: whoever brought a paid guest.
    insert into notifications (user_id, type, title, body, data)
    select g.invited_by, 'callup_cancelled_paid', new.title || ' was cancelled',
           'You had paid for ' || g.display_name || '. Ask the club''s admin about the refund.',
           jsonb_build_object('event_id', new.id, 'club_id', new.club_id)
      from club_event_guest_payments gp join club_event_guests g on g.id = gp.guest_id
     where gp.event_id = new.id and gp.paid_at is not null and g.invited_by is not null;
  end if;
  return new;
end;
$$;

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
  v_n int;
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
                      where r.event_id = e.id and p.paid_at is null)
                  + (select count(*) from club_event_guest_payments gp where gp.event_id = e.id and gp.receipt is not null and gp.paid_at is null));
    end if;
    -- 0085: my own spot if unpaid, plus each unpaid guest I brought.
    select (case when exists (select 1 from callup_payers(e.id) cp where cp.user_id = v_uid) and not callup_is_paid(e.id, v_uid) then 1 else 0 end)
           + (select count(*) from callup_guest_payers(e.id) gp where gp.invited_by = v_uid and not guest_is_paid(gp.guest_id))::int
      into v_n;
    if v_n > 0 then
      v_owe := v_owe || jsonb_build_object(
        'event_id', e.id, 'slug', e.slug, 'title', e.title, 'scheduled_at', e.scheduled_at,
        'cost', e.cost, 'payment_mode', e.payment_mode,
        'spots', v_n,
        'has_receipt', callup_has_receipt(e.id, v_uid));
    end if;
  end loop;
  return jsonb_build_object('collect', v_collect, 'owe', v_owe);
end;
$$;

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
           + (select count(*)::int from club_event_guest_payments gp
               where gp.event_id = e.id and gp.receipt is not null and gp.paid_at is null)
      from club_events e
     where e.club_id = p_club_id and e.status = 'scheduled'
       and e.payment_mode in ('receipt', 'prepay')
       and e.scheduled_at > now() - interval '6 hours'
       and e.scheduled_at < now() + interval '14 days'
       and (exists (select 1 from club_event_receipts r
                     join club_event_payments p on p.event_id = r.event_id and p.user_id = r.user_id
                    where r.event_id = e.id and p.paid_at is null)
            or exists (select 1 from club_event_guest_payments gp
                    where gp.event_id = e.id and gp.receipt is not null and gp.paid_at is null))
     order by e.scheduled_at;
end;
$$;

revoke all on function get_callup_guest_payments(uuid) from public, anon;
revoke all on function upload_guest_receipt(uuid, text, text) from public, anon;
revoke all on function get_guest_receipt(uuid) from public, anon;
revoke all on function set_guest_payment(uuid, text, text) from public, anon;
grant execute on function get_callup_guest_payments(uuid) to authenticated;
grant execute on function upload_guest_receipt(uuid, text, text) to authenticated;
grant execute on function get_guest_receipt(uuid) to authenticated;
grant execute on function set_guest_payment(uuid, text, text) to authenticated;
-- Internals stay internal.
revoke all on function guest_is_paid(uuid) from public, anon, authenticated;
revoke all on function guest_has_receipt(uuid) from public, anon, authenticated;
revoke all on function callup_guest_payers(uuid) from public, anon, authenticated;
revoke all on function callup_pending_queue(uuid) from public, anon, authenticated;
revoke all on function callup_demote_guest(club_events, uuid) from public, anon, authenticated;
revoke all on function callup_start_guest_window(uuid) from public, anon, authenticated;
revoke all on function callup_payers(uuid) from public, anon, authenticated;
revoke all on function callup_totals(uuid) from public, anon, authenticated;
revoke all on function callup_pending_spots(uuid, uuid) from public, anon, authenticated;
revoke all on function callup_my_waiting_spots(uuid, uuid) from public, anon, authenticated;
