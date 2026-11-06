-- ---------------------------------------------------------------------
-- 0080_callup_payments.sql
--
-- Paying for a Call-up (ADR-001, agreed with Hamud 6 Nov 2026). Run AFTER
-- 0079. Money never moves through the app; this only records who paid.
--
-- Per Call-up the admin picks:
--   'none'     as before
--   'tick'     admins tick who has paid. Bookkeeping only: no uploads, no
--              deadlines, nobody is moved.
--   'receipt'  players who are in upload a transfer receipt; admins check it.
--              Deadline 6 h before the start: whoever is in with NO receipt
--              moves to the back of the waiting list, and the people moved up
--              get 1 hour to pay. The hour doesn't run 22:00-07:00 (Jakarta).
--              Nothing moves in the last hour before the start.
-- Notes: club_events.notes existed since 0022; the app now shows it to
-- members (bank details, QRIS, ...).
--
-- Who sees what: a player sees their own status; members see "8 of 12 paid";
-- the club's owner and admins see everyone, and the receipts.
-- Receipts: kept in club_event_receipts (never readable directly, only through
-- the functions below), deleted 3 days after the night.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- ── 1. Columns and tables ─────────────────────────────────────────────
alter table club_events add column if not exists payment_mode text not null default 'none';
do $$ begin
  alter table club_events add constraint club_events_payment_mode_check check (payment_mode in ('none', 'tick', 'receipt'));
exception when duplicate_object then null; end $$;
-- Bookkeeping for the deadline engine, so each step happens once.
alter table club_events add column if not exists pay_reminded_24_at timestamptz;
alter table club_events add column if not exists pay_reminded_last_at timestamptz;
alter table club_events add column if not exists pay_deadline_done_at timestamptz;

-- One row per member who owes for a Call-up: their own spot and any guests
-- they brought (guests are paid on their member's receipt).
create table if not exists club_event_payments (
  event_id          uuid not null references club_events(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  paid_at           timestamptz,
  paid_by           uuid references auth.users(id) on delete set null,
  receipt_at        timestamptz,
  rejected_at       timestamptz,
  rejected_reason   text,
  -- A personal 1-hour window: moved up from the waiting list, joined after
  -- the deadline, or a receipt rejected after it.
  pay_by            timestamptz,
  -- Moved to the waiting list for not paying. Such a player isn't moved up
  -- again automatically (it would bounce them in and out every hour); they
  -- can take an open spot themselves by answering I'm in again.
  demoted_at        timestamptz,
  primary key (event_id, user_id)
);
alter table club_event_payments add column if not exists demoted_at timestamptz;
alter table club_event_payments enable row level security;
-- No policies: read and written only through the functions below.

create table if not exists club_event_receipts (
  event_id    uuid not null references club_events(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  image       bytea not null,
  mime        text not null,
  uploaded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table club_event_receipts enable row level security;
revoke all on club_event_receipts from anon, authenticated;
revoke all on club_event_payments from anon, authenticated;

-- ── 2. Helpers ────────────────────────────────────────────────────────
-- Inside the 1-hour windows' working day? (Jakarta)
create or replace function jakarta_daytime(p_at timestamptz) returns boolean
language sql stable as $$
  select extract(hour from p_at at time zone 'Asia/Jakarta') between 7 and 21
$$;

-- One hour of DAYTIME from p_from: the clock stops 22:00-07:00 Jakarta.
create or replace function pay_window_end(p_from timestamptz) returns timestamptz
language plpgsql stable as $$
declare
  v_local   timestamp := p_from at time zone 'Asia/Jakarta';
  v_start   timestamp;
  v_night   timestamp;
  v_used    interval;
begin
  if extract(hour from v_local) >= 22 then
    v_start := date_trunc('day', v_local) + interval '1 day 7 hours';
  elsif extract(hour from v_local) < 7 then
    v_start := date_trunc('day', v_local) + interval '7 hours';
  else
    v_start := v_local;
  end if;
  v_night := date_trunc('day', v_start) + interval '22 hours';
  if v_start + interval '1 hour' <= v_night then
    return (v_start + interval '1 hour') at time zone 'Asia/Jakarta';
  end if;
  v_used := v_night - v_start;
  return (date_trunc('day', v_start) + interval '1 day 7 hours' + (interval '1 hour' - v_used)) at time zone 'Asia/Jakarta';
end;
$$;

-- Does someone taking a spot right now get a 1-hour window?
create or replace function callup_window_applies(p_ev club_events) returns boolean
language sql stable as $$
  select p_ev.payment_mode = 'receipt' and p_ev.status = 'scheduled'
     and now() >= p_ev.scheduled_at - interval '6 hours'
     and now() <  p_ev.scheduled_at - interval '1 hour'
$$;

-- The members who hold at least one spot that is in (themselves or a guest).
create or replace function callup_payers(p_event_id uuid)
returns table (user_id uuid, own_in boolean, guests_in int)
language sql stable security definer set search_path = public as $$
  with holders as (
    select r.user_id, true as own, 0 as g from club_event_rsvps r
     where r.event_id = p_event_id and r.response = 'in'
    union all
    select g.invited_by, false, 1 from club_event_guests g
     where g.event_id = p_event_id and g.response = 'in' and g.invited_by is not null
  )
  select user_id, bool_or(own), sum(g)::int from holders group by user_id
$$;

create or replace function callup_is_paid(p_event_id uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_event_payments
                  where event_id = p_event_id and user_id = p_user and paid_at is not null)
$$;
create or replace function callup_has_receipt(p_event_id uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_event_receipts where event_id = p_event_id and user_id = p_user)
$$;

-- Start a payer's window (if one applies and they aren't covered already).
-- Returns the window's end, or null.
create or replace function callup_start_window(p_event_id uuid, p_user uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_ev club_events%rowtype;
  v_end timestamptz;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found or not callup_window_applies(v_ev) then return null; end if;
  if callup_is_paid(p_event_id, p_user) or callup_has_receipt(p_event_id, p_user) then return null; end if;
  v_end := pay_window_end(now());
  insert into club_event_payments (event_id, user_id, pay_by) values (p_event_id, p_user, v_end)
  on conflict (event_id, user_id) do update set pay_by = excluded.pay_by, demoted_at = null;
  return v_end;
end;
$$;

-- ── 3. Taking a spot after the deadline starts the hour ───────────────
-- One place for every way in: answering "I'm in", bringing a guest, being
-- moved up. Moving up sets padelier.promoting so its own message can carry the
-- hour instead of sending a second one.
create or replace function trg_callup_spot_taken() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_payer uuid;
  v_end timestamptz;
  v_ev club_events%rowtype;
begin
  if TG_TABLE_NAME = 'club_event_rsvps' then
    v_payer := new.user_id;
  else
    v_payer := new.invited_by;
  end if;
  if v_payer is null or new.response <> 'in' then return new; end if;
  if TG_OP = 'UPDATE' and old.response = 'in' then return new; end if;

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
drop trigger if exists callup_spot_taken on club_event_rsvps;
create trigger callup_spot_taken after insert or update of response on club_event_rsvps
  for each row execute function trg_callup_spot_taken();
drop trigger if exists callup_spot_taken on club_event_guests;
create trigger callup_spot_taken after insert or update of response on club_event_guests
  for each row execute function trg_callup_spot_taken();

-- A paid player stepping out: the admins should know (refunds are theirs).
create or replace function trg_callup_paid_left() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ev club_events%rowtype;
begin
  if old.response = 'in' and new.response <> 'in' and callup_is_paid(new.event_id, new.user_id) then
    select * into v_ev from club_events where id = new.event_id;
    insert into notifications (user_id, type, title, body, data)
    select cm.user_id, 'callup_paid_left',
           coalesce((select display_name from profiles where id = new.user_id), 'Someone') || ' paid but can''t make it',
           v_ev.title || ': they had paid. Sort out a refund if your club does them.',
           jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id)
      from club_members cm
     where cm.club_id = v_ev.club_id and cm.role in ('owner', 'admin') and cm.user_id <> new.user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists callup_paid_left on club_event_rsvps;
create trigger callup_paid_left after update of response on club_event_rsvps
  for each row execute function trg_callup_paid_left();

-- A cancelled Call-up: whoever paid is told to ask about a refund.
create or replace function trg_callup_cancelled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status <> 'cancelled' and new.status = 'cancelled' and new.payment_mode <> 'none' then
    insert into notifications (user_id, type, title, body, data)
    select p.user_id, 'callup_cancelled_paid', new.title || ' was cancelled',
           'You had paid for it. Ask the club''s admin about your refund.',
           jsonb_build_object('event_id', new.id, 'club_id', new.club_id)
      from club_event_payments p where p.event_id = new.id and p.paid_at is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists callup_cancelled on club_events;
create trigger callup_cancelled after update of status on club_events
  for each row execute function trg_callup_cancelled();

-- ── 4. Moving up from the waiting list (0056, plus the hour) ──────────
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
       and not exists (select 1 from club_event_payments d
                        where d.event_id = p_event_id and d.user_id = g.invited_by and d.demoted_at is not null)
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
  select pay_by into v_end from club_event_payments
   where event_id = p_event_id and user_id = v_payer and callup_window_applies(v_ev);
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

-- ── 5. The deadline engine (every 5 minutes) ──────────────────────────
-- Move one payer's spots to the back of the waiting list.
create or replace function callup_demote(p_ev club_events, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update club_event_rsvps set response = 'waitlist', responded_at = now()
   where event_id = p_ev.id and user_id = p_user and response = 'in';
  update club_event_guests set response = 'waitlist', created_at = now()
   where event_id = p_ev.id and invited_by = p_user and response = 'in';
  insert into club_event_payments (event_id, user_id, demoted_at) values (p_ev.id, p_user, now())
  on conflict (event_id, user_id) do update set pay_by = null, demoted_at = now();
  insert into notifications (user_id, type, title, body, data)
  values (p_user, 'callup_moved_unpaid',
    'Moved to the waiting list: ' || p_ev.title,
    'Your spot wasn''t paid in time, so it went to the next person. If a spot opens up, answer I''m in again to take it (you''ll have 1 hour to pay).',
    jsonb_build_object('event_id', p_ev.id, 'club_id', p_ev.club_id));
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

  return v_moved;
end;
$$;
revoke all on function process_callup_payments() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled: Call-up payment deadlines will not run until it is.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'callup-payments') then
    perform cron.unschedule('callup-payments');
  end if;
  perform cron.schedule('callup-payments', '*/5 * * * *', 'select public.process_callup_payments()');
end;
$$;

-- ── 6. What the app calls ─────────────────────────────────────────────
create or replace function callup_admin(p_ev club_events) returns boolean
language sql stable security definer set search_path = public as $$
  select is_club_admin(p_ev.club_id) or is_app_admin()
$$;

-- Admin: payment mode and notes, when posting or editing.
create or replace function set_callup_options(p_event_id uuid, p_payment_mode text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev club_events%rowtype;
  v_was text;
  cp record;
begin
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then raise exception 'That Call-up no longer exists.' using errcode = 'P0002'; end if;
  if not callup_admin(v_ev) then raise exception 'Only the club''s owner and admins can change this.' using errcode = 'P0001'; end if;
  if p_payment_mode not in ('none', 'tick', 'receipt') then raise exception 'Not a payment option.' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_notes, '')) > 1000 then raise exception 'Notes are limited to 1000 characters.' using errcode = 'P0001'; end if;
  v_was := v_ev.payment_mode;
  update club_events set payment_mode = p_payment_mode, notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_event_id
   returning * into v_ev;
  -- Switched to receipts after the deadline: everyone in gets their hour.
  if v_was <> 'receipt' and p_payment_mode = 'receipt' and callup_window_applies(v_ev) then
    for cp in select user_id from callup_payers(p_event_id) loop
      perform callup_start_window(p_event_id, cp.user_id);
    end loop;
  end if;
  return jsonb_build_object('payment_mode', v_ev.payment_mode, 'notes', v_ev.notes);
end;
$$;

-- Any member: the Call-up's notes and payment picture, from their side.
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
    return jsonb_build_object('member', false);
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

-- Admin: everyone who holds a spot (or has paid), for the Payments list.
create or replace function get_callup_payments(p_event_id uuid)
returns table (user_id uuid, display_name text, avatar_url text, own_in boolean, guests_in int,
               paid_at timestamptz, has_receipt boolean, receipt_at timestamptz, rejected_reason text, pay_by timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_ev club_events%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found or not callup_admin(v_ev) then
    raise exception 'Only the club''s owner and admins can see payments.' using errcode = 'P0001';
  end if;
  return query
    with who as (
      select cp.user_id, cp.own_in, cp.guests_in from callup_payers(p_event_id) cp
      union
      select pay.user_id, false, 0 from club_event_payments pay
       where pay.event_id = p_event_id and pay.paid_at is not null
         and not exists (select 1 from callup_payers(p_event_id) c where c.user_id = pay.user_id)
    )
    select w.user_id, pr.display_name, pr.avatar_url, w.own_in, w.guests_in,
           pay.paid_at, callup_has_receipt(p_event_id, w.user_id), pay.receipt_at, pay.rejected_reason,
           case when pay.pay_by > now() then pay.pay_by end
      from who w
      left join profiles pr on pr.id = w.user_id
      left join club_event_payments pay on pay.event_id = p_event_id and pay.user_id = w.user_id
     order by (pay.paid_at is not null), callup_has_receipt(p_event_id, w.user_id) desc, pr.display_name;
end;
$$;

-- Player: upload (or replace) the receipt. Only while holding a spot.
create or replace function upload_callup_receipt(p_event_id uuid, p_image_base64 text, p_mime text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ev club_events%rowtype;
  v_img bytea;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = 'P0001'; end if;
  select * into v_ev from club_events where id = p_event_id;
  if not found or v_ev.status <> 'scheduled' then raise exception 'That Call-up isn''t open.' using errcode = 'P0001'; end if;
  if v_ev.payment_mode <> 'receipt' then raise exception 'This Call-up doesn''t take receipts.' using errcode = 'P0001'; end if;
  if not exists (select 1 from callup_payers(p_event_id) where user_id = v_uid) then
    raise exception 'Only players who are in can upload a receipt.' using errcode = 'P0001';
  end if;
  if callup_is_paid(p_event_id, v_uid) then raise exception 'You''re already marked as paid.' using errcode = 'P0001'; end if;
  if p_mime not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Upload a photo or screenshot.' using errcode = 'P0001'; end if;
  begin
    v_img := decode(p_image_base64, 'base64');
  exception when others then
    raise exception 'That image couldn''t be read.' using errcode = 'P0001';
  end;
  if length(v_img) > 900000 then raise exception 'That image is too large.' using errcode = 'P0001'; end if;

  insert into club_event_receipts (event_id, user_id, image, mime) values (p_event_id, v_uid, v_img, p_mime)
  on conflict (event_id, user_id) do update set image = excluded.image, mime = excluded.mime, uploaded_at = now();
  insert into club_event_payments (event_id, user_id, receipt_at) values (p_event_id, v_uid, now())
  on conflict (event_id, user_id) do update set receipt_at = now(), rejected_at = null, rejected_reason = null;
  return get_callup_extras(p_event_id);
end;
$$;

-- The uploader, or the club's owner/admins: the receipt image.
create or replace function get_callup_receipt(p_event_id uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ev club_events%rowtype;
  v_r club_event_receipts%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found then return null; end if;
  if not (auth.uid() = p_user_id or callup_admin(v_ev)) then
    raise exception 'Only the club''s owner and admins can see receipts.' using errcode = 'P0001';
  end if;
  select * into v_r from club_event_receipts where event_id = p_event_id and user_id = p_user_id;
  if not found then return null; end if;
  return jsonb_build_object('mime', v_r.mime, 'image', encode(v_r.image, 'base64'), 'uploaded_at', v_r.uploaded_at);
end;
$$;

-- Admin: paid / not paid / receipt rejected.
create or replace function set_callup_payment(p_event_id uuid, p_user_id uuid, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ev club_events%rowtype;
  v_end timestamptz;
begin
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then raise exception 'That Call-up no longer exists.' using errcode = 'P0002'; end if;
  if not callup_admin(v_ev) then raise exception 'Only the club''s owner and admins can mark payments.' using errcode = 'P0001'; end if;
  if v_ev.payment_mode = 'none' then raise exception 'This Call-up has no payment.' using errcode = 'P0001'; end if;

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

revoke all on function set_callup_options(uuid, text, text) from public, anon;
revoke all on function get_callup_extras(uuid) from public, anon;
revoke all on function get_callup_payments(uuid) from public, anon;
revoke all on function upload_callup_receipt(uuid, text, text) from public, anon;
revoke all on function get_callup_receipt(uuid, uuid) from public, anon;
revoke all on function set_callup_payment(uuid, uuid, text, text) from public, anon;
grant execute on function set_callup_options(uuid, text, text) to authenticated;
grant execute on function get_callup_extras(uuid) to authenticated;
grant execute on function get_callup_payments(uuid) to authenticated;
grant execute on function upload_callup_receipt(uuid, text, text) to authenticated;
grant execute on function get_callup_receipt(uuid, uuid) to authenticated;
grant execute on function set_callup_payment(uuid, uuid, text, text) to authenticated;
-- Internals stay internal.
revoke all on function callup_payers(uuid) from public, anon, authenticated;
revoke all on function callup_start_window(uuid, uuid) from public, anon, authenticated;
revoke all on function callup_demote(club_events, uuid) from public, anon, authenticated;
