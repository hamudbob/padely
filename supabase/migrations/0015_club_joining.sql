-- ---------------------------------------------------------------------
-- 0015_club_joining.sql  (Phase 2, increment 2 — discovery & joining)
--
-- Join requests (search / code → request → admin accepts) and invites (an admin
-- invites an existing account by email). All mutations go through SECURITY
-- DEFINER RPCs that enforce roles + the membership limits. One pending request /
-- invite per person per club (re-request allowed after a decline).
-- ---------------------------------------------------------------------

create table if not exists club_join_requests (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id) on delete set null
);
-- At most one PENDING request per person per club; declined/accepted rows may
-- accumulate (so re-requesting after a decline is allowed).
create unique index if not exists club_join_requests_pending_uidx
  on club_join_requests (club_id, user_id) where status = 'pending';
create index if not exists club_join_requests_club_idx on club_join_requests (club_id, status);

create table if not exists club_invites (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references clubs(id) on delete cascade,
  inviter_id uuid references profiles(id) on delete set null,
  invitee_id uuid not null references profiles(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists club_invites_pending_uidx
  on club_invites (club_id, invitee_id) where status = 'pending';
create index if not exists club_invites_invitee_idx on club_invites (invitee_id, status);

alter table club_join_requests enable row level security;
alter table club_invites enable row level security;

-- A user sees their own requests; a club's admins see requests for their club.
drop policy if exists club_join_requests_read on club_join_requests;
create policy club_join_requests_read on club_join_requests for select to authenticated
  using (user_id = auth.uid() or is_club_admin(club_id));

-- The invitee sees their invites; a club's admins see invites they sent out.
drop policy if exists club_invites_read on club_invites;
create policy club_invites_read on club_invites for select to authenticated
  using (invitee_id = auth.uid() or is_club_admin(club_id));

-- --- Join / invite RPCs -----------------------------------------------

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
  return jsonb_build_object('club_id', v_club, 'name', v_name, 'request_id', v_req);
end;
$$;

create or replace function respond_join_request(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_club uuid; v_user uuid; v_status text; v_members int; v_user_member int;
begin
  select club_id, user_id, status into v_club, v_user, v_status from club_join_requests where id = p_request_id;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if not is_club_admin(v_club) then raise exception 'Only admins can decide requests.' using errcode = 'P0001'; end if;
  if v_status <> 'pending' then return; end if;

  if p_accept then
    if not exists (select 1 from club_members where club_id = v_club and user_id = v_user) then
      select count(*) into v_members from club_members where club_id = v_club;
      if v_members >= 99 then raise exception 'This team is full (99 members).' using errcode = 'P0001'; end if;
      select count(*) into v_user_member from club_members where user_id = v_user;
      if v_user_member >= 25 then raise exception 'That player is already in 25 teams.' using errcode = 'P0001'; end if;
      insert into club_members (club_id, user_id, role) values (v_club, v_user, 'member');
    end if;
    update club_join_requests set status = 'accepted', decided_at = now(), decided_by = auth.uid() where id = p_request_id;
  else
    update club_join_requests set status = 'declined', decided_at = now(), decided_by = auth.uid() where id = p_request_id;
  end if;
end;
$$;

-- Invite an EXISTING account by email. Bundling the lookup with the invite (and
-- gating on admin) avoids a general email→exists oracle.
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
  return jsonb_build_object('invite_id', v_inv);
end;
$$;

create or replace function respond_club_invite(p_invite_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_club uuid; v_invitee uuid; v_status text; v_members int; v_user_member int;
begin
  select club_id, invitee_id, status into v_club, v_invitee, v_status from club_invites where id = p_invite_id;
  if not found then raise exception 'Invite not found.' using errcode = 'P0002'; end if;
  if v_invitee <> auth.uid() then raise exception 'That invite isn''t yours.' using errcode = 'P0001'; end if;
  if v_status <> 'pending' then return; end if;

  if p_accept then
    if not exists (select 1 from club_members where club_id = v_club and user_id = v_invitee) then
      select count(*) into v_members from club_members where club_id = v_club;
      if v_members >= 99 then raise exception 'This team is full (99 members).' using errcode = 'P0001'; end if;
      select count(*) into v_user_member from club_members where user_id = v_invitee;
      if v_user_member >= 25 then raise exception 'You are already in 25 teams.' using errcode = 'P0001'; end if;
      insert into club_members (club_id, user_id, role) values (v_club, v_invitee, 'member');
    end if;
    update club_invites set status = 'accepted', decided_at = now() where id = p_invite_id;
  else
    update club_invites set status = 'declined', decided_at = now() where id = p_invite_id;
  end if;
end;
$$;

grant execute on function request_to_join_club(uuid) to authenticated;
grant execute on function join_club_by_code(text) to authenticated;
grant execute on function respond_join_request(uuid, boolean) to authenticated;
grant execute on function invite_by_email(uuid, text) to authenticated;
grant execute on function respond_club_invite(uuid, boolean) to authenticated;
