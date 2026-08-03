-- ---------------------------------------------------------------------
-- 0014_teams.sql  (Phase 2, increment 1 — teams/clubs core)
--
-- The user-facing "Teams" feature. Tables are named clubs/club_members to avoid
-- colliding with the legacy per-host `teams` table (the container that owns a
-- host's sessions). UI still says "Team".
--
-- Roles (owner / admin / member), a shareable join code, and the spec's limits.
-- All membership mutations go through SECURITY DEFINER RPCs that enforce roles +
-- limits — there are NO direct insert/update/delete policies on club_members, so
-- the rules can't be bypassed. Club name/logo can be edited directly by admins.
--
-- Limits: own ≤5 · admin-of ≤10 (incl. owned) · member-of ≤25 · ≤5 admins/club
-- (owner counts as one) · ≤99 members/club.
-- ---------------------------------------------------------------------

create table if not exists clubs (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 60),
  club_code           text not null unique,
  logo_url            text,
  -- League settings (used from Phase 3; harmless defaults now).
  session_floor       integer not null default 10,
  league_period       text not null default 'monthly'
                        check (league_period in ('monthly','2_month','3_month','6_month','yearly')),
  league_min_sessions integer not null default 3,
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists club_members (
  club_id   uuid not null references clubs(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index if not exists club_members_user_idx on club_members (user_id);

alter table clubs enable row level security;
alter table club_members enable row level security;

create or replace function is_club_member(p_club_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_members where club_id = p_club_id and user_id = auth.uid());
$$;
create or replace function is_club_admin(p_club_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_members where club_id = p_club_id and user_id = auth.uid() and role in ('owner','admin'));
$$;

drop policy if exists clubs_read on clubs;
create policy clubs_read on clubs for select to authenticated using (true);
drop policy if exists clubs_update_admin on clubs;
create policy clubs_update_admin on clubs for update to authenticated
  using (is_club_admin(id)) with check (is_club_admin(id));

drop policy if exists club_members_read on club_members;
create policy club_members_read on club_members for select to authenticated using (true);

-- --- Membership RPCs --------------------------------------------------

create or replace function create_club(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owned int; v_member int; v_club_id uuid; v_code text;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = 'P0001'; end if;
  if char_length(coalesce(trim(p_name), '')) = 0 then raise exception 'Give your team a name.' using errcode = 'P0001'; end if;

  select count(*) into v_owned from club_members where user_id = v_uid and role = 'owner';
  if v_owned >= 5 then raise exception 'You can own at most 5 teams.' using errcode = 'P0001'; end if;
  select count(*) into v_member from club_members where user_id = v_uid;
  if v_member >= 25 then raise exception 'You can be in at most 25 teams.' using errcode = 'P0001'; end if;

  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from clubs where club_code = v_code);
  end loop;

  insert into clubs (name, club_code, created_by) values (trim(p_name), v_code, v_uid) returning id into v_club_id;
  insert into club_members (club_id, user_id, role) values (v_club_id, v_uid, 'owner');
  return jsonb_build_object('id', v_club_id, 'code', v_code);
end;
$$;

create or replace function leave_club(p_club_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_new_owner uuid;
begin
  select role into v_role from club_members where club_id = p_club_id and user_id = v_uid;
  if v_role is null then raise exception 'You are not in this team.' using errcode = 'P0001'; end if;

  delete from club_members where club_id = p_club_id and user_id = v_uid;

  if v_role = 'owner' then
    -- Auto-succession: longest-tenured admin, else longest-tenured member.
    select user_id into v_new_owner from club_members where club_id = p_club_id and role = 'admin' order by joined_at asc limit 1;
    if v_new_owner is null then
      select user_id into v_new_owner from club_members where club_id = p_club_id order by joined_at asc limit 1;
    end if;
    if v_new_owner is null then
      delete from clubs where id = p_club_id; -- team is now empty
    else
      update club_members set role = 'owner' where club_id = p_club_id and user_id = v_new_owner;
    end if;
  end if;
end;
$$;

create or replace function club_kick_member(p_club_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller text; v_target text;
begin
  select role into v_caller from club_members where club_id = p_club_id and user_id = auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then
    raise exception 'Only admins can remove members.' using errcode = 'P0001';
  end if;
  select role into v_target from club_members where club_id = p_club_id and user_id = p_user_id;
  if v_target is null then return; end if;
  if v_target = 'owner' then raise exception 'The owner can''t be removed.' using errcode = 'P0001'; end if;
  if v_target = 'admin' and v_caller <> 'owner' then
    raise exception 'Only the owner can remove an admin.' using errcode = 'P0001';
  end if;
  delete from club_members where club_id = p_club_id and user_id = p_user_id;
end;
$$;

create or replace function club_set_member_role(p_club_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller text; v_target text; v_admins int; v_target_admin_of int;
begin
  if p_role not in ('admin','member') then raise exception 'Invalid role.' using errcode = 'P0001'; end if;
  select role into v_caller from club_members where club_id = p_club_id and user_id = auth.uid();
  select role into v_target from club_members where club_id = p_club_id and user_id = p_user_id;
  if v_target is null then raise exception 'That person is not in the team.' using errcode = 'P0001'; end if;
  if v_target = 'owner' then raise exception 'The owner role changes only through succession.' using errcode = 'P0001'; end if;

  if p_role = 'admin' then
    if v_caller is null or v_caller not in ('owner','admin') then
      raise exception 'Only admins can promote members.' using errcode = 'P0001';
    end if;
    if v_target = 'admin' then return; end if;
    select count(*) into v_admins from club_members where club_id = p_club_id and role in ('owner','admin');
    if v_admins >= 5 then raise exception 'A team can have at most 5 admins.' using errcode = 'P0001'; end if;
    select count(*) into v_target_admin_of from club_members where user_id = p_user_id and role in ('owner','admin');
    if v_target_admin_of >= 10 then raise exception 'That player is already an admin of 10 teams.' using errcode = 'P0001'; end if;
  else
    if v_caller <> 'owner' then raise exception 'Only the owner can change an admin.' using errcode = 'P0001'; end if;
  end if;

  update club_members set role = p_role where club_id = p_club_id and user_id = p_user_id;
end;
$$;

grant execute on function create_club(text) to authenticated;
grant execute on function leave_club(uuid) to authenticated;
grant execute on function club_kick_member(uuid, uuid) to authenticated;
grant execute on function club_set_member_role(uuid, uuid, text) to authenticated;
grant execute on function is_club_member(uuid) to authenticated;
grant execute on function is_club_admin(uuid) to authenticated;
