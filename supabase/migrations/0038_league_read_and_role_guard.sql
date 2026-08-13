-- ---------------------------------------------------------------------
-- 0038_league_read_and_role_guard.sql
--
-- Two fixes found in the pre-release audit. Both are small; both were
-- invisible from the host's own account, which is why they survived.
--
-- 1. THE LEAGUE BOARD WAS EMPTY FOR EVERY MEMBER WHO WASN'T THE HOST.
--    0021 dropped `club_members_read_sessions` and replaced it with the
--    column-scoped get_club_sessions() RPC — correctly, it stopped members
--    reading whole session rows. But the league query still reads `sessions`
--    directly to find which of them count toward the league, and after 0021
--    the only SELECT-capable policy left on that table is host_all_sessions
--    (created_by = auth.uid()). A non-host member reads zero rows, so every
--    result row is skipped and the board renders "0 of N sessions qualified"
--    forever. RLS makes an unauthorised read an EMPTY RESULT, not an error,
--    which is exactly why nothing surfaced.
--
--    Fix: return counts_for_league from the RPC the member is allowed to call.
--
-- 2. ANY SIGNED-UP USER COULD DEMOTE ADMINS IN ANY CLUB.
--    club_set_member_role's member branch read `if v_caller <> 'owner'`. For
--    someone who isn't in the club at all, v_caller is NULL, `NULL <> 'owner'`
--    is NULL, and PL/pgSQL treats a NULL IF as false — so the guard never
--    fired and the UPDATE ran. A real member was correctly blocked; only a
--    stranger got through. The promote branch above it already used the
--    null-safe form.
--
--    Fix: `is distinct from`, which is null-safe by definition. The rest of
--    the body is reproduced verbatim from 0014 — `create or replace` replaces
--    the whole function, so anything not restated here would be lost.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

-- --- 1. Members can see which sessions count toward the league ---------
-- DROP first, not just CREATE OR REPLACE: 0021 defined this function with a
-- nine-column RETURNS TABLE, and Postgres treats those OUT columns as part of
-- the signature. Replacing a function cannot change its return row type —
-- "cannot change return type of existing function" (42P13). Adding a column
-- therefore means dropping and recreating, which is safe here because nothing
-- else in the schema depends on it (no view, no other function) and the grant
-- is reissued below. NOT `cascade` — if something ever does depend on it, this
-- should fail loudly rather than quietly delete it.
drop function if exists get_club_sessions(uuid);

create or replace function get_club_sessions(p_club_id uuid)
returns table (
  id uuid, name text, status text, format text,
  created_at timestamptz, started_at timestamptz, ended_at timestamptz,
  public_token text, created_by uuid, counts_for_league boolean
) language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.status, s.format, s.created_at, s.started_at, s.ended_at,
         s.public_token, s.created_by, coalesce(s.counts_for_league, true)
  from sessions s
  where s.club_id = p_club_id and s.status <> 'draft' and is_club_member(p_club_id)
  order by s.created_at desc;
$$;
grant execute on function get_club_sessions(uuid) to authenticated;

-- --- 2. Null-safe caller check on role changes -------------------------
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
    -- `is distinct from` rather than `<>`: NULL <> 'owner' is NULL, and a NULL
    -- condition is not an exception — it's a silent pass straight to the UPDATE.
    if v_caller is distinct from 'owner' then
      raise exception 'Only the owner can change an admin.' using errcode = 'P0001';
    end if;
  end if;

  update club_members set role = p_role where club_id = p_club_id and user_id = p_user_id;
end;
$$;
grant execute on function club_set_member_role(uuid, uuid, text) to authenticated;
