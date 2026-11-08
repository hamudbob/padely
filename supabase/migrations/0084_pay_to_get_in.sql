-- ---------------------------------------------------------------------
-- 0084_pay_to_get_in.sql
--
-- A fourth payment option, "Pay to get in" (Hamud, 8 Nov 2026). Run AFTER
-- 0083.
--
--   * Answering "I'm in" (or bringing a guest) puts you on the waiting list.
--   * From the waiting list you upload your transfer receipt. The upload is
--     timed to the second; that time is your place in the queue.
--   * An admin accepts receipts, first uploaded first. Accepting moves you in,
--     with any guests you have waiting.
--   * Uploading closes once spots taken plus receipts waiting to be checked
--     fill the night. A rejected or withdrawn receipt opens it again, and the
--     people waiting are told when a spot opens.
--   * Nobody is moved up for free in this mode.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

alter table club_events drop constraint if exists club_events_payment_mode_check;
alter table club_events add constraint club_events_payment_mode_check
  check (payment_mode in ('none', 'tick', 'receipt', 'prepay'));

-- Spots a member would fill if let in: themselves plus their waiting guests.
create or replace function callup_my_waiting_spots(p_event_id uuid, p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select 1 + (select count(*)::int from club_event_guests
               where event_id = p_event_id and invited_by = p_user and response = 'waitlist')
$$;

-- Spots held by receipts waiting to be checked (optionally not counting one
-- person's own).
create or replace function callup_pending_spots(p_event_id uuid, p_except uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(callup_my_waiting_spots(p_event_id, r.user_id)), 0)::int
    from club_event_rsvps r
   where r.event_id = p_event_id and r.response = 'waitlist'
     and (p_except is null or r.user_id <> p_except)
     and callup_has_receipt(p_event_id, r.user_id)
     and not callup_is_paid(p_event_id, r.user_id)
$$;

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
  if p_payment_mode not in ('none', 'tick', 'receipt', 'prepay') then raise exception 'Not a payment option.' using errcode = 'P0001'; end if;
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
      select r.user_id, 'callup_spot_open', 'A spot opened: ' || v_ev.title,
             'Upload your transfer receipt to ask for it. Receipts are checked in the order they arrive.',
             jsonb_build_object('event_id', p_event_id, 'club_id', v_ev.club_id)
        from club_event_rsvps r
       where r.event_id = p_event_id and r.response = 'waitlist'
         and not callup_has_receipt(p_event_id, r.user_id);
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

create or replace function set_event_rsvp(p_event_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_ev        club_events%rowtype;
  v_was       text;
  v_effective text;
  v_in_count  int;
  v_promoted  uuid;
  v_waitlist  boolean;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if p_response not in ('in', 'maybe', 'out', 'waitlist') then
    raise exception 'Not a valid answer.' using errcode = 'P0001';
  end if;

  -- The lock that makes the cap true. Everything below counts under it.
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then
    raise exception 'That session is no longer scheduled.' using errcode = 'P0002';
  end if;
  if v_ev.status <> 'scheduled' then
    raise exception 'That session was cancelled.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from club_members where club_id = v_ev.club_id and user_id = v_uid) then
    raise exception 'Only club members can answer this.' using errcode = 'P0001';
  end if;

  select response into v_was from club_event_rsvps where event_id = p_event_id and user_id = v_uid;

  -- 0084: Pay to get in. Answering "I'm in" puts you on the waiting list;
  -- an admin accepting your receipt is what moves you in. Someone already
  -- accepted (paid) who answers again takes a free spot as usual.
  if p_response = 'in' and v_ev.payment_mode = 'prepay' and v_was is distinct from 'in'
     and not callup_is_paid(p_event_id, v_uid) then
    v_effective := 'waitlist';
  elsif p_response = 'in' then
    -- Everyone else who is in — members other than me, plus every guest.
    select (select count(*) from club_event_rsvps
             where event_id = p_event_id and response = 'in' and user_id <> v_uid)
         + (select count(*) from club_event_guests
             where event_id = p_event_id and response = 'in')
      into v_in_count;
    -- No cap, or room left: in. Otherwise the queue, not a refusal.
    v_effective := case
      when v_ev.max_players is null or v_in_count < v_ev.max_players then 'in'
      else 'waitlist'
    end;
    -- 0079: a club without a waiting list says "full" instead.
    if v_effective = 'waitlist' then
      select coalesce(waitlist_enabled, true) into v_waitlist from clubs where id = v_ev.club_id;
      if not v_waitlist then
        raise exception 'This Call-up is full.' using errcode = 'P0001';
      end if;
    end if;
  else
    v_effective := p_response;
  end if;

  insert into club_event_rsvps (event_id, user_id, response, responded_at)
  values (p_event_id, v_uid, v_effective, now())
  on conflict (event_id, user_id)
  do update set response = excluded.response, responded_at = excluded.responded_at;

  -- 0084: leaving the queue with a receipt waiting withdraws it, so the
  -- place it was holding opens for someone else.
  if v_ev.payment_mode = 'prepay' and v_effective not in ('in', 'waitlist') and not callup_is_paid(p_event_id, v_uid) then
    delete from club_event_receipts where event_id = p_event_id and user_id = v_uid;
    update club_event_payments set receipt_at = null where event_id = p_event_id and user_id = v_uid;
  end if;

  -- Someone stepping out of a full night hands their place on.
  if v_was = 'in' and v_effective <> 'in' then
    v_promoted := promote_next_waitlister(p_event_id);
  end if;

  return jsonb_build_object(
    'response', v_effective,
    'asked_for', p_response,
    'waitlisted', (v_effective = 'waitlist' and p_response = 'in'),
    'prepay', v_ev.payment_mode = 'prepay',
    'position', case when v_effective = 'waitlist' then (
      select count(*) from club_event_rsvps
       where event_id = p_event_id and response = 'waitlist'
         and responded_at <= (select responded_at from club_event_rsvps
                               where event_id = p_event_id and user_id = v_uid)
    ) end,
    'in_count', event_in_count(p_event_id),
    'promoted_user_id', v_promoted
  );
end;
$$;

create or replace function add_event_guest(p_event_id uuid, p_name text, p_gender text default 'M')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_ev     club_events%rowtype;
  v_name   text := btrim(coalesce(p_name, ''));
  v_gender char := case when upper(coalesce(p_gender, 'M')) = 'F' then 'F' else 'M' end;
  v_mine   int;
  v_resp   text;
  v_id     uuid;
  v_max_guests int;
  v_waitlist boolean;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if char_length(v_name) = 0 then
    raise exception 'Give your guest a name.' using errcode = 'P0001';
  end if;
  if char_length(v_name) > 40 then
    raise exception 'That name is too long.' using errcode = 'P0001';
  end if;

  -- Same lock as set_event_rsvp, for the same reason: two people adding a
  -- guest at once must not both read "11 in" and both be let through.
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then
    raise exception 'That session is no longer scheduled.' using errcode = 'P0002';
  end if;
  if v_ev.status <> 'scheduled' then
    raise exception 'That session was cancelled.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from club_members where club_id = v_ev.club_id and user_id = v_uid) then
    raise exception 'Only club members can bring a guest.' using errcode = 'P0001';
  end if;

  -- 0079: the club decides how many guests a member may bring (0-3).
  select coalesce(max_guests, 3), coalesce(waitlist_enabled, true)
    into v_max_guests, v_waitlist from clubs where id = v_ev.club_id;
  if v_max_guests = 0 then
    raise exception 'This club doesn''t take guests.' using errcode = 'P0001';
  end if;
  select count(*) into v_mine
    from club_event_guests where event_id = p_event_id and invited_by = v_uid;
  if v_mine >= v_max_guests then
    raise exception '%', case when v_max_guests = 1 then 'You can bring one guest to a Call-up.'
                              else 'You can bring up to ' || v_max_guests || ' guests to a Call-up.' end
      using errcode = 'P0001';
  end if;

  -- Full means the waiting list, not a refusal — exactly as it works for a
  -- member. A guest who never gets a place simply never gets one.
  v_resp := case
    when v_ev.max_players is null or event_in_count(p_event_id) < v_ev.max_players then 'in'
    else 'waitlist'
  end;
  -- 0084: Pay to get in. A guest waits too, and moves in with the member's
  -- accepted receipt.
  if v_ev.payment_mode = 'prepay' then
    v_resp := 'waitlist';
  end if;
  -- 0079: a club without a waiting list says "full" instead.
  if v_resp = 'waitlist' and not v_waitlist and v_ev.payment_mode <> 'prepay' then
    raise exception 'This Call-up is full.' using errcode = 'P0001';
  end if;

  insert into club_event_guests (event_id, display_name, gender, invited_by, response)
  values (p_event_id, v_name, v_gender, v_uid, v_resp)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'name', v_name,
    'gender', v_gender,
    'response', v_resp,
    'waitlisted', v_resp = 'waitlist',
    'in_count', event_in_count(p_event_id)
  );
end;
$$;

create or replace function upload_callup_receipt(p_event_id uuid, p_image_base64 text, p_mime text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ev club_events%rowtype;
  v_img bytea;
  v_mine int;
  v_room int;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = 'P0001'; end if;
  select * into v_ev from club_events where id = p_event_id;
  if not found or v_ev.status <> 'scheduled' then raise exception 'That Call-up isn''t open.' using errcode = 'P0001'; end if;
  if v_ev.payment_mode not in ('receipt', 'prepay') then raise exception 'This Call-up doesn''t take receipts.' using errcode = 'P0001'; end if;
  if v_ev.payment_mode = 'prepay' then
    -- 0084: Pay to get in. Upload from the waiting list, and only while a
    -- spot is free: spots taken plus receipts waiting to be checked must
    -- leave room for everyone this receipt covers.
    select * into v_ev from club_events where id = p_event_id for update;
    if not exists (select 1 from club_event_rsvps where event_id = p_event_id and user_id = v_uid and response in ('waitlist', 'in'))
       and not exists (select 1 from callup_payers(p_event_id) where user_id = v_uid) then
      raise exception 'Answer I''m in first, then upload your receipt.' using errcode = 'P0001';
    end if;
    if v_ev.max_players is not null and not callup_has_receipt(p_event_id, v_uid) then
      v_mine := callup_my_waiting_spots(p_event_id, v_uid);
      v_room := v_ev.max_players - event_in_count(p_event_id) - callup_pending_spots(p_event_id, v_uid);
      if v_room < greatest(v_mine, 1) then
        raise exception 'Every spot is taken or being checked. If one frees up you''ll be told.' using errcode = 'P0001';
      end if;
    end if;
  elsif not exists (select 1 from callup_payers(p_event_id) where user_id = v_uid) then
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
  -- 0084: in Pay to get in the queue is by upload time, so replacing a
  -- receipt that is still waiting keeps its place.
  insert into club_event_payments (event_id, user_id, receipt_at) values (p_event_id, v_uid, clock_timestamp())
  on conflict (event_id, user_id) do update
    set receipt_at = case when v_ev.payment_mode = 'prepay' and club_event_payments.receipt_at is not null
                               and club_event_payments.rejected_at is null
                          then club_event_payments.receipt_at else clock_timestamp() end,
        rejected_at = null, rejected_reason = null;
  return get_callup_extras(p_event_id);
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
    v_room := v_room - 1;
    for g in select id from club_event_guests where event_id = p_event_id and invited_by = p_user_id and response = 'waitlist' order by created_at loop
      exit when v_room < 1;
      update club_event_guests set response = 'in' where id = g.id;
      v_room := v_room - 1;
    end loop;
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
       select count(*) from club_event_payments p
        where p.event_id = p_event_id and p.paid_at is null and p.receipt_at is not null
          and callup_has_receipt(p_event_id, p.user_id) and p.receipt_at <= v_pay.receipt_at) end,
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
      union
      -- 0084: waiting with a receipt (Pay to get in): asking for a spot.
      select r.user_id, false, callup_my_waiting_spots(p_event_id, r.user_id) - 1 from club_event_rsvps r
       where r.event_id = p_event_id and r.response = 'waitlist' and callup_has_receipt(p_event_id, r.user_id)
         and not callup_is_paid(p_event_id, r.user_id)
    )
    select w.user_id, pr.display_name, pr.avatar_url, w.own_in, w.guests_in,
           pay.paid_at, callup_has_receipt(p_event_id, w.user_id), pay.receipt_at, pay.rejected_reason,
           case when pay.pay_by > now() then pay.pay_by end
      from who w
      left join profiles pr on pr.id = w.user_id
      left join club_event_payments pay on pay.event_id = p_event_id and pay.user_id = w.user_id
     order by (pay.paid_at is not null), callup_has_receipt(p_event_id, w.user_id) desc, pay.receipt_at asc nulls last, pr.display_name;
end;
$$;

-- Needs you: receipts to check, Pay to get in nights too.
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
       and e.payment_mode in ('receipt', 'prepay')
       and e.scheduled_at > now() - interval '6 hours'
       and e.scheduled_at < now() + interval '14 days'
       and exists (select 1 from club_event_receipts r
                     join club_event_payments p on p.event_id = r.event_id and p.user_id = r.user_id
                    where r.event_id = e.id and p.paid_at is null)
     order by e.scheduled_at;
end;
$$;

revoke all on function callup_my_waiting_spots(uuid, uuid) from public, anon, authenticated;
revoke all on function callup_pending_spots(uuid, uuid) from public, anon, authenticated;
