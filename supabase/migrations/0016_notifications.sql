-- ---------------------------------------------------------------------
-- 0016_notifications.sql  (Phase 2, increment 3 — notification center)
--
-- A per-user notification feed. Rows are written ONLY by the SECURITY DEFINER
-- club RPCs (re-created below to emit notifications in the same transaction as
-- the event) — there is no client insert policy. A user can read, mark-read, and
-- clear their own notifications.
--
-- Events wired now: join request received (→ club admins), request decided
-- (→ requester), invite received (→ invitee), invite accepted (→ inviter).
-- ---------------------------------------------------------------------

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, read, created_at desc);

alter table notifications enable row level security;
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update_own on notifications;
create policy notifications_update_own on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_delete_own on notifications;
create policy notifications_delete_own on notifications for delete to authenticated using (user_id = auth.uid());

-- --- Re-create the club RPCs to also emit notifications ----------------

create or replace function request_to_join_club(p_club_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_req uuid;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = 'P0001'; end if;
  if not exists (select 1 from clubs where id = p_club_id) then raise exception 'Team not found.' using errcode = 'P0002'; end if;
  if exists (select 1 from club_members where club_id = p_club_id and user_id = v_uid) then
    raise exception 'You are already in this team.' using errcode = 'P0001';
  end if;
  if exists (select 1 from club_join_requests where club_id = p_club_id and user_id = v_uid and status = 'pending') then
    raise exception 'You already have a request waiting.' using errcode = 'P0001';
  end if;
  insert into club_join_requests (club_id, user_id) values (p_club_id, v_uid) returning id into v_req;

  insert into notifications (user_id, type, title, body, data)
  select cm.user_id, 'join_request', 'New join request',
         (select display_name from profiles where id = v_uid) || ' wants to join ' || (select name from clubs where id = p_club_id),
         jsonb_build_object('club_id', p_club_id, 'request_id', v_req)
  from club_members cm where cm.club_id = p_club_id and cm.role in ('owner','admin');

  return jsonb_build_object('request_id', v_req);
end;
$$;

create or replace function join_club_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_club uuid; v_name text; v_req uuid;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = 'P0001'; end if;
  select id, name into v_club, v_name from clubs where club_code = upper(trim(p_code));
  if not found then raise exception 'No team matches that code.' using errcode = 'P0002'; end if;
  if exists (select 1 from club_members where club_id = v_club and user_id = v_uid) then
    return jsonb_build_object('club_id', v_club, 'name', v_name, 'already_member', true);
  end if;
  if exists (select 1 from club_join_requests where club_id = v_club and user_id = v_uid and status = 'pending') then
    return jsonb_build_object('club_id', v_club, 'name', v_name, 'already_requested', true);
  end if;
  insert into club_join_requests (club_id, user_id) values (v_club, v_uid) returning id into v_req;

  insert into notifications (user_id, type, title, body, data)
  select cm.user_id, 'join_request', 'New join request',
         (select display_name from profiles where id = v_uid) || ' wants to join ' || v_name,
         jsonb_build_object('club_id', v_club, 'request_id', v_req)
  from club_members cm where cm.club_id = v_club and cm.role in ('owner','admin');

  return jsonb_build_object('club_id', v_club, 'name', v_name, 'request_id', v_req);
end;
$$;

create or replace function respond_join_request(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_club uuid; v_user uuid; v_status text; v_members int; v_user_member int; v_club_name text;
begin
  select club_id, user_id, status into v_club, v_user, v_status from club_join_requests where id = p_request_id;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if not is_club_admin(v_club) then raise exception 'Only admins can decide requests.' using errcode = 'P0001'; end if;
  if v_status <> 'pending' then return; end if;
  select name into v_club_name from clubs where id = v_club;

  if p_accept then
    if not exists (select 1 from club_members where club_id = v_club and user_id = v_user) then
      select count(*) into v_members from club_members where club_id = v_club;
      if v_members >= 99 then raise exception 'This team is full (99 members).' using errcode = 'P0001'; end if;
      select count(*) into v_user_member from club_members where user_id = v_user;
      if v_user_member >= 25 then raise exception 'That player is already in 25 teams.' using errcode = 'P0001'; end if;
      insert into club_members (club_id, user_id, role) values (v_club, v_user, 'member');
    end if;
    update club_join_requests set status = 'accepted', decided_at = now(), decided_by = auth.uid() where id = p_request_id;
    insert into notifications (user_id, type, title, body, data)
      values (v_user, 'request_accepted', 'Request accepted', 'You''re now a member of ' || v_club_name, jsonb_build_object('club_id', v_club));
  else
    update club_join_requests set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = p_request_id;
    insert into notifications (user_id, type, title, body, data)
      values (v_user, 'request_declined', 'Request declined', 'Your request to join ' || v_club_name || ' wasn''t accepted', jsonb_build_object('club_id', v_club));
  end if;
end;
$$;

create or replace function invite_by_email(p_club_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_invitee uuid; v_inv uuid;
begin
  if not is_club_admin(p_club_id) then raise exception 'Only admins can invite.' using errcode = 'P0001'; end if;
  select id into v_invitee from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_invitee is null then raise exception 'No Padelier account uses that email yet.' using errcode = 'P0002'; end if;
  if exists (select 1 from club_members where club_id = p_club_id and user_id = v_invitee) then
    raise exception 'They are already in this team.' using errcode = 'P0001';
  end if;
  if exists (select 1 from club_invites where club_id = p_club_id and invitee_id = v_invitee and status = 'pending') then
    raise exception 'They already have a pending invite.' using errcode = 'P0001';
  end if;
  insert into club_invites (club_id, inviter_id, invitee_id) values (p_club_id, auth.uid(), v_invitee) returning id into v_inv;

  insert into notifications (user_id, type, title, body, data)
    values (v_invitee, 'invite', 'Team invite',
            (select display_name from profiles where id = auth.uid()) || ' invited you to ' || (select name from clubs where id = p_club_id),
            jsonb_build_object('club_id', p_club_id, 'invite_id', v_inv));

  return jsonb_build_object('invite_id', v_inv);
end;
$$;

create or replace function respond_club_invite(p_invite_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_club uuid; v_invitee uuid; v_inviter uuid; v_status text; v_members int; v_user_member int; v_club_name text;
begin
  select club_id, invitee_id, inviter_id, status into v_club, v_invitee, v_inviter, v_status from club_invites where id = p_invite_id;
  if not found then raise exception 'Invite not found.' using errcode = 'P0002'; end if;
  if v_invitee <> auth.uid() then raise exception 'That invite isn''t yours.' using errcode = 'P0001'; end if;
  if v_status <> 'pending' then return; end if;
  select name into v_club_name from clubs where id = v_club;

  if p_accept then
    if not exists (select 1 from club_members where club_id = v_club and user_id = v_invitee) then
      select count(*) into v_members from club_members where club_id = v_club;
      if v_members >= 99 then raise exception 'This team is full (99 members).' using errcode = 'P0001'; end if;
      select count(*) into v_user_member from club_members where user_id = v_invitee;
      if v_user_member >= 25 then raise exception 'You are already in 25 teams.' using errcode = 'P0001'; end if;
      insert into club_members (club_id, user_id, role) values (v_club, v_invitee, 'member');
    end if;
    update club_invites set status = 'accepted', decided_at = now() where id = p_invite_id;
    if v_inviter is not null then
      insert into notifications (user_id, type, title, body, data)
        values (v_inviter, 'invite_accepted', 'Invite accepted',
                (select display_name from profiles where id = v_invitee) || ' joined ' || v_club_name, jsonb_build_object('club_id', v_club));
    end if;
  else
    update club_invites set status = 'declined', decided_at = now() where id = p_invite_id;
  end if;
end;
$$;
