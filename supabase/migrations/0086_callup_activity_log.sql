-- ---------------------------------------------------------------------
-- 0086_callup_activity_log.sql
--
-- An activity log for every Call-up (Hamud, 17 Nov 2026). Run AFTER 0085.
--
-- Every step is recorded with the time to the second and who did it:
--   * players: answered I'm in / Maybe / Can't make it, joined the waiting
--     list, uploaded or replaced a receipt, added or removed a guest;
--   * admins, by name: moved someone in or out, marked paid, accepted or
--     rejected a receipt, undid a payment, removed a guest, called the night
--     off, changed the payment option;
--   * Padelier itself (no name): moved someone up from the waiting list, gave
--     someone their hour to pay, moved someone down for not paying.
-- Only the club's owner and admins can read it (get_callup_log).
--
-- Also: an admin can move a guest in from the waiting list, as for a member
-- (event_set_guest_rsvp); and the Payments list says who marked each payment.
--
-- Recording starts when this runs; earlier nights have no log.
-- Safe to re-run.
-- ---------------------------------------------------------------------

create table if not exists club_event_log (
  id            bigserial primary key,
  event_id      uuid not null references club_events(id) on delete cascade,
  at            timestamptz not null default clock_timestamp(),
  -- Who did it. Null: Padelier did it by itself.
  actor_id      uuid references auth.users(id) on delete set null,
  subject_user  uuid,
  subject_guest uuid,
  -- Kept as written at the time, so a later rename or removal can't blank it.
  subject_name  text,
  action        text not null,
  detail        jsonb
);
create index if not exists club_event_log_event on club_event_log (event_id, at desc);
alter table club_event_log enable row level security;
revoke all on club_event_log from anon, authenticated;
-- No policies: written by triggers, read through get_callup_log.

-- Who is acting right now: nobody when Padelier is moving the queue on its
-- own (a promotion inside someone else's answer, or the deadline job).
create or replace function callup_log_actor() returns uuid
language sql stable as $$
  select case when coalesce(current_setting('padelier.promoting', true), '') = '1' then null else auth.uid() end
$$;

create or replace function callup_log(p_event uuid, p_actor uuid, p_user uuid, p_guest uuid, p_name text, p_action text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into club_event_log (event_id, actor_id, subject_user, subject_guest, subject_name, action, detail)
  values (p_event, p_actor, p_user, p_guest, p_name, p_action, nullif(p_detail, '{}'::jsonb))
$$;

-- ── Answers ───────────────────────────────────────────────────────────
create or replace function trg_log_rsvp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := callup_log_actor();
  v_admin boolean;
  v_action text;
  v_cause text := nullif(current_setting('padelier.cause', true), '');
begin
  if TG_OP = 'UPDATE' and old.response is not distinct from new.response then return new; end if;
  -- Moved for not paying is always Padelier's doing, whoever's session ran it.
  if v_cause is not null then v_actor := null; end if;
  v_admin := v_actor is not null and v_actor <> new.user_id;
  v_action := case new.response
    when 'in'       then case when v_actor is null then 'moved_up' when v_admin then 'admin_moved_in' else 'answered_in' end
    when 'waitlist' then case when v_actor is null then 'moved_to_waitlist' when v_admin then 'admin_to_waitlist' else 'joined_waitlist' end
    when 'maybe'    then case when v_admin then 'admin_set_maybe' else 'answered_maybe' end
    else                 case when v_admin then 'admin_took_out' else 'answered_out' end
  end;
  perform callup_log(new.event_id, v_actor, new.user_id, null,
    (select display_name from profiles where id = new.user_id), v_action,
    jsonb_strip_nulls(jsonb_build_object('was', case when TG_OP = 'UPDATE' then old.response end, 'cause', v_cause)));
  return new;
end;
$$;
drop trigger if exists log_rsvp on club_event_rsvps;
create trigger log_rsvp after insert or update of response on club_event_rsvps
  for each row execute function trg_log_rsvp();

-- ── Guests ────────────────────────────────────────────────────────────
create or replace function trg_log_guest() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := callup_log_actor();
  v_g club_event_guests%rowtype;
  v_admin boolean;
  v_action text;
  v_cause text := nullif(current_setting('padelier.cause', true), '');
begin
  if TG_OP = 'DELETE' then v_g := old; else v_g := new; end if;
  if TG_OP = 'UPDATE' and old.response is not distinct from new.response then return new; end if;
  if v_cause is not null then v_actor := null; end if;
  v_admin := v_actor is not null and v_actor is distinct from v_g.invited_by;
  v_action := case
    when TG_OP = 'INSERT' then 'guest_added'
    when TG_OP = 'DELETE' then case when v_admin then 'admin_removed_guest' else 'guest_removed' end
    when new.response = 'in' then case when v_actor is null then 'moved_up' when v_admin then 'admin_moved_in' else 'guest_in' end
    else case when v_actor is null then 'moved_to_waitlist' when v_admin then 'admin_to_waitlist' else 'guest_waiting' end
  end;
  perform callup_log(v_g.event_id, v_actor, null, v_g.id, v_g.display_name, v_action,
    jsonb_strip_nulls(jsonb_build_object(
      'guest_of', (select display_name from profiles where id = v_g.invited_by),
      'response', case when TG_OP = 'INSERT' then v_g.response end,
      'cause', v_cause)));
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists log_guest on club_event_guests;
create trigger log_guest after insert or update of response or delete on club_event_guests
  for each row execute function trg_log_guest();

-- ── Payments ──────────────────────────────────────────────────────────
create or replace function trg_log_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := (select display_name from profiles where id = new.user_id);
  v_old_paid timestamptz; v_old_rej timestamptz; v_old_by timestamptz;
begin
  if TG_OP = 'UPDATE' then v_old_paid := old.paid_at; v_old_rej := old.rejected_at; v_old_by := old.pay_by; end if;
  if new.paid_at is not null and v_old_paid is null then
    perform callup_log(new.event_id, coalesce(new.paid_by, auth.uid()), new.user_id, null, v_name,
      case when callup_has_receipt(new.event_id, new.user_id) then 'receipt_accepted' else 'marked_paid' end);
  elsif new.paid_at is null and v_old_paid is not null then
    perform callup_log(new.event_id, auth.uid(), new.user_id, null, v_name, 'payment_undone');
  end if;
  if new.rejected_at is not null and new.rejected_at is distinct from v_old_rej then
    perform callup_log(new.event_id, auth.uid(), new.user_id, null, v_name, 'receipt_rejected',
      jsonb_strip_nulls(jsonb_build_object('reason', new.rejected_reason)));
  end if;
  if new.pay_by is not null and new.pay_by is distinct from v_old_by then
    perform callup_log(new.event_id, null, new.user_id, null, v_name, 'pay_window', jsonb_build_object('until', new.pay_by));
  end if;
  return new;
end;
$$;
drop trigger if exists log_payment on club_event_payments;
create trigger log_payment after insert or update on club_event_payments
  for each row execute function trg_log_payment();

create or replace function trg_log_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform callup_log(new.event_id, auth.uid(), new.user_id, null,
    (select display_name from profiles where id = new.user_id),
    case when TG_OP = 'INSERT' then 'receipt_uploaded' else 'receipt_replaced' end);
  return new;
end;
$$;
drop trigger if exists log_receipt on club_event_receipts;
create trigger log_receipt after insert or update on club_event_receipts
  for each row execute function trg_log_receipt();

create or replace function trg_log_guest_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_g club_event_guests%rowtype;
  v_old club_event_guest_payments%rowtype;
  v_det jsonb;
begin
  select * into v_g from club_event_guests where id = new.guest_id;
  if TG_OP = 'UPDATE' then v_old := old; end if;
  v_det := jsonb_strip_nulls(jsonb_build_object('guest_of', (select display_name from profiles where id = v_g.invited_by)));
  if new.paid_at is not null and v_old.paid_at is null then
    perform callup_log(new.event_id, coalesce(new.paid_by, auth.uid()), null, new.guest_id, v_g.display_name,
      case when new.receipt is not null then 'receipt_accepted' else 'marked_paid' end, v_det);
  elsif new.paid_at is null and v_old.paid_at is not null then
    perform callup_log(new.event_id, auth.uid(), null, new.guest_id, v_g.display_name, 'payment_undone', v_det);
  end if;
  if new.receipt is not null and (v_old.receipt is null or new.receipt <> v_old.receipt) then
    perform callup_log(new.event_id, auth.uid(), null, new.guest_id, v_g.display_name,
      case when v_old.receipt is null then 'receipt_uploaded' else 'receipt_replaced' end, v_det);
  end if;
  if new.rejected_at is not null and new.rejected_at is distinct from v_old.rejected_at then
    perform callup_log(new.event_id, auth.uid(), null, new.guest_id, v_g.display_name, 'receipt_rejected',
      v_det || jsonb_strip_nulls(jsonb_build_object('reason', new.rejected_reason)));
  end if;
  if new.pay_by is not null and new.pay_by is distinct from v_old.pay_by then
    perform callup_log(new.event_id, null, null, new.guest_id, v_g.display_name, 'pay_window', v_det || jsonb_build_object('until', new.pay_by));
  end if;
  return new;
end;
$$;
drop trigger if exists log_guest_payment on club_event_guest_payments;
create trigger log_guest_payment after insert or update on club_event_guest_payments
  for each row execute function trg_log_guest_payment();

create or replace function trg_log_walkin() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old timestamptz;
begin
  if TG_OP = 'UPDATE' then v_old := old.paid_at; end if;
  if new.paid_at is not null and v_old is null then
    perform callup_log(new.event_id, coalesce(new.paid_by, auth.uid()), null, null, new.display_name, 'marked_paid', '{"walk_in": true}'::jsonb);
  elsif new.paid_at is null and v_old is not null then
    perform callup_log(new.event_id, auth.uid(), null, null, new.display_name, 'payment_undone', '{"walk_in": true}'::jsonb);
  end if;
  return new;
end;
$$;
drop trigger if exists log_walkin on club_event_walkin_payments;
create trigger log_walkin after insert or update on club_event_walkin_payments
  for each row execute function trg_log_walkin();

-- ── The night itself ──────────────────────────────────────────────────
create or replace function trg_log_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    perform callup_log(new.id, coalesce(v_actor, new.created_by), null, null, null, 'posted');
    return new;
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform callup_log(new.id, v_actor, null, null, null, 'called_off');
  end if;
  if new.payment_mode is distinct from old.payment_mode then
    perform callup_log(new.id, v_actor, null, null, null, 'payment_changed', jsonb_build_object('from', old.payment_mode, 'to', new.payment_mode));
  end if;
  if new.scheduled_at is distinct from old.scheduled_at then
    perform callup_log(new.id, v_actor, null, null, null, 'time_changed', jsonb_build_object('from', old.scheduled_at, 'to', new.scheduled_at));
  end if;
  if new.max_players is distinct from old.max_players then
    perform callup_log(new.id, v_actor, null, null, null, 'cap_changed', jsonb_build_object('from', old.max_players, 'to', new.max_players));
  end if;
  if new.session_id is not null and old.session_id is null then
    perform callup_log(new.id, v_actor, null, null, null, 'session_started');
  end if;
  if new.payments_closed_at is not null and old.payments_closed_at is null then
    perform callup_log(new.id, v_actor, null, null, null, 'collecting_done');
  elsif new.payments_closed_at is null and old.payments_closed_at is not null then
    perform callup_log(new.id, v_actor, null, null, null, 'collecting_reopened');
  end if;
  return new;
end;
$$;
drop trigger if exists log_event on club_events;
create trigger log_event after insert or update on club_events
  for each row execute function trg_log_event();


create or replace function callup_demote(p_ev club_events, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- 0086: the log says why.
  perform set_config('padelier.cause', 'unpaid', true);
  update club_event_rsvps set response = 'waitlist', responded_at = now()
   where event_id = p_ev.id and user_id = p_user and response = 'in';
  insert into club_event_payments (event_id, user_id, demoted_at) values (p_ev.id, p_user, now())
  on conflict (event_id, user_id) do update set pay_by = null, demoted_at = now();
  perform set_config('padelier.cause', '', true);
  insert into notifications (user_id, type, title, body, data)
  values (p_user, 'callup_moved_unpaid',
    'Moved to the waiting list: ' || p_ev.title,
    'Your spot wasn''t paid in time, so it went to the next person. If a spot opens up, answer I''m in again to take it (you''ll have 1 hour to pay).',
    jsonb_build_object('event_id', p_ev.id, 'club_id', p_ev.club_id));
end;
$$;

create or replace function callup_demote_guest(p_ev club_events, p_guest uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_g club_event_guests%rowtype;
begin
  select * into v_g from club_event_guests where id = p_guest;
  if not found then return; end if;
  perform set_config('padelier.cause', 'unpaid', true);
  update club_event_guests set response = 'waitlist', created_at = now() where id = p_guest and response = 'in';
  perform set_config('padelier.cause', '', true);
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

-- Admin: move a guest in (may go over the cap, as for a member) or back to
-- the waiting list.
create or replace function event_set_guest_rsvp(p_guest_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_g club_event_guests%rowtype;
  v_ev club_events%rowtype;
begin
  if p_response not in ('in', 'waitlist') then raise exception 'Not a valid answer.' using errcode = 'P0001'; end if;
  select * into v_g from club_event_guests where id = p_guest_id;
  if not found then raise exception 'That guest is no longer on this Call-up.' using errcode = 'P0002'; end if;
  select * into v_ev from club_events where id = v_g.event_id for update;
  if not (callup_admin(v_ev)) then
    raise exception 'Only a club admin can move a guest.' using errcode = 'P0001';
  end if;
  if v_ev.status <> 'scheduled' then raise exception 'That Call-up isn''t open.' using errcode = 'P0001'; end if;
  update club_event_guests set response = p_response,
         created_at = case when p_response = 'waitlist' then now() else created_at end
   where id = p_guest_id;
  if v_g.response = 'in' and p_response <> 'in' then
    perform promote_next_waitlister(v_ev.id);
  end if;
  if p_response = 'in' and v_g.response <> 'in' and v_g.invited_by is not null then
    insert into notifications (user_id, type, title, body, data)
    values (v_g.invited_by, 'event_promoted', v_g.display_name || ' is in for ' || v_ev.title,
      'An admin moved your guest in. ' || to_char(v_ev.scheduled_at at time zone 'Asia/Jakarta', 'Dy DD Mon at HH24:MI') ||
        coalesce(' · ' || v_ev.location, '') || '.',
      jsonb_build_object('event_id', v_ev.id, 'club_id', v_ev.club_id));
  end if;
  return jsonb_build_object('guest_id', p_guest_id, 'response', p_response, 'in_count', event_in_count(v_ev.id));
end;
$$;

-- Admin: the log, newest first.
create or replace function get_callup_log(p_event_id uuid, p_limit int default 500)
returns table (at timestamptz, actor_name text, automatic boolean, subject_name text, is_guest boolean, action text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare v_ev club_events%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found or not callup_admin(v_ev) then
    raise exception 'Only the club''s owner and admins can see the activity.' using errcode = 'P0001';
  end if;
  return query
    select l.at, pr.display_name, l.actor_id is null, l.subject_name, l.subject_guest is not null, l.action, l.detail
      from club_event_log l left join profiles pr on pr.id = l.actor_id
     where l.event_id = p_event_id
     order by l.at desc, l.id desc
     limit greatest(1, least(coalesce(p_limit, 500), 2000));
end;
$$;


drop function if exists get_callup_payments(uuid);
create or replace function get_callup_payments(p_event_id uuid)
returns table (user_id uuid, display_name text, avatar_url text, own_in boolean, guests_in int,
               paid_at timestamptz, has_receipt boolean, receipt_at timestamptz, rejected_reason text, pay_by timestamptz,
               paid_by_name text)
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
      union
      -- 0084: waiting with a receipt (Pay to get in): asking for a spot.
      select r.user_id, false, callup_my_waiting_spots(p_event_id, r.user_id) - 1 from club_event_rsvps r
       where r.event_id = p_event_id and r.response = 'waitlist' and callup_has_receipt(p_event_id, r.user_id)
         and not callup_is_paid(p_event_id, r.user_id)
    )
    select w.user_id, pr.display_name, pr.avatar_url, w.own_in, w.guests_in,
           pay.paid_at, callup_has_receipt(p_event_id, w.user_id), pay.receipt_at, pay.rejected_reason,
           case when pay.pay_by > now() then pay.pay_by end,
           (select px.display_name from profiles px where px.id = pay.paid_by)
      from who w
      left join profiles pr on pr.id = w.user_id
      left join club_event_payments pay on pay.event_id = p_event_id and pay.user_id = w.user_id
     order by (pay.paid_at is not null), callup_has_receipt(p_event_id, w.user_id) desc, pay.receipt_at asc nulls last, pr.display_name;
end;
$$;

drop function if exists get_callup_guest_payments(uuid);
create or replace function get_callup_guest_payments(p_event_id uuid)
returns table (guest_id uuid, display_name text, invited_by uuid, invited_by_name text, response text,
               paid_at timestamptz, has_receipt boolean, receipt_at timestamptz, rejected_reason text, pay_by timestamptz,
               holds_spot boolean, paid_by_name text)
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
           exists (select 1 from callup_guest_payers(p_event_id) x where x.guest_id = g.id),
           (select px.display_name from profiles px where px.id = gp.paid_by)
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

revoke all on function get_callup_payments(uuid) from public, anon;
revoke all on function get_callup_guest_payments(uuid) from public, anon;
revoke all on function get_callup_log(uuid, int) from public, anon;
revoke all on function event_set_guest_rsvp(uuid, text) from public, anon;
grant execute on function get_callup_payments(uuid) to authenticated;
grant execute on function get_callup_guest_payments(uuid) to authenticated;
grant execute on function get_callup_log(uuid, int) to authenticated;
grant execute on function event_set_guest_rsvp(uuid, text) to authenticated;
revoke all on function callup_log(uuid, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function callup_demote(club_events, uuid) from public, anon, authenticated;
revoke all on function callup_demote_guest(club_events, uuid) from public, anon, authenticated;
