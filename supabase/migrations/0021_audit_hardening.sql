-- ---------------------------------------------------------------------
-- 0021_audit_hardening.sql  (Phase 3 audit — security & integrity fixes)
--
-- Addresses the audit's Tier-1/Tier-2 findings:
--  #3  apply_session_ratings could overwrite ANY user's global rating —
--      now restricted to accounts that actually played the session.
--  #5  session results are now once-only (like ratings) so a re-end can't
--      diverge from the rating snapshot; session_date is the first end.
--  #9  session_results.perf_adj — an opponent-adjusted per-session score the
--      client computes, so Club Score can be genuinely opponent-aware.
--  #4  a session may only be attributed to a club the host belongs to.
--  #2/#8  members read the club session list through a column-scoped RPC
--      (not the whole sessions row — no join_code / token / draft_state).
--  #8  club_members is no longer world-readable; discovery goes through
--      search_clubs() so rosters can't be enumerated platform-wide.
--  #7  pin search_path on the older SECURITY DEFINER functions.
--  #6  owner succession now runs on ANY membership removal (incl. account
--      deletion), via an AFTER DELETE trigger — leave_club no longer does it.
-- Additive & safe to re-run.
-- ---------------------------------------------------------------------

-- --- #5 idempotency flag + #9 opponent-adjusted column ------------------
alter table sessions add column if not exists results_applied boolean not null default false;
alter table session_results add column if not exists perf_adj numeric not null default 0.5;

-- --- #3 apply_session_ratings: only rate actual participants ------------
create or replace function apply_session_ratings(p_session_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_applied boolean;
  u jsonb;
begin
  select status, coalesce(ratings_applied, false) into v_status, v_applied
    from sessions where id = p_session_id;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not is_session_host(p_session_id) then
    raise exception 'Only the host can apply ratings for this session.' using errcode = 'P0001';
  end if;
  if v_status <> 'ended' then
    raise exception 'Ratings apply only once a session has ended.' using errcode = 'P0001';
  end if;
  if v_applied then return; end if;

  for u in select value from jsonb_array_elements(p_updates) as value loop
    -- Only accounts that actually played THIS session may be rated — closes the
    -- "throwaway session overwrites a stranger's global rating" hole.
    if not exists (
      select 1 from players
      where session_id = p_session_id and linked_user_id = (u->>'user_id')::uuid
    ) then
      continue;
    end if;

    update profiles set
      rating            = (u->>'rating')::numeric,
      rating_deviation  = (u->>'rd')::numeric,
      rating_volatility = (u->>'vol')::numeric,
      rating_games      = (u->>'games')::int,
      updated_at        = now()
    where id = (u->>'user_id')::uuid;

    insert into rating_history (user_id, session_id, rating, delta)
      values ((u->>'user_id')::uuid, p_session_id, (u->>'rating')::numeric, (u->>'delta')::numeric);
  end loop;

  update sessions set ratings_applied = true where id = p_session_id;
end;
$$;

-- --- #5 apply_session_results: once-only, frozen date, + perf_adj -------
create or replace function apply_session_results(p_session_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_club    uuid;
  v_date    timestamptz;
  v_applied boolean;
  r jsonb;
begin
  select status, club_id, coalesce(ended_at, now()), coalesce(results_applied, false)
    into v_status, v_club, v_date, v_applied
    from sessions where id = p_session_id;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not is_session_host(p_session_id) then
    raise exception 'Only the host can record results for this session.' using errcode = 'P0001';
  end if;
  if v_status <> 'ended' then
    raise exception 'Results are recorded only once a session has ended.' using errcode = 'P0001';
  end if;
  if v_applied then return; end if; -- once-only, consistent with ratings

  delete from session_results where session_id = p_session_id; -- clean any partial retry
  if v_club is null then
    update sessions set results_applied = true where id = p_session_id;
    return;
  end if;

  for r in select value from jsonb_array_elements(p_rows) as value loop
    insert into session_results (
      session_id, club_id, user_id, session_date, rank, field_size, player_count,
      placement_points, podium_bonus, wins, losses, draws, scored_points, perf_adj
    ) values (
      p_session_id, v_club, (r->>'user_id')::uuid, v_date,
      (r->>'rank')::int, (r->>'field_size')::int, (r->>'player_count')::int,
      (r->>'placement_points')::int, coalesce((r->>'podium_bonus')::int, 0),
      coalesce((r->>'wins')::int, 0), coalesce((r->>'losses')::int, 0),
      coalesce((r->>'draws')::int, 0), coalesce((r->>'scored_points')::numeric, 0),
      coalesce((r->>'perf_adj')::numeric, 0.5)
    )
    on conflict (session_id, user_id) do update set
      club_id = excluded.club_id, session_date = excluded.session_date, rank = excluded.rank,
      field_size = excluded.field_size, player_count = excluded.player_count,
      placement_points = excluded.placement_points, podium_bonus = excluded.podium_bonus,
      wins = excluded.wins, losses = excluded.losses, draws = excluded.draws,
      scored_points = excluded.scored_points, perf_adj = excluded.perf_adj;
  end loop;

  update sessions set results_applied = true where id = p_session_id;
end;
$$;

-- --- #4 a session may only be attributed to a club the host belongs to --
drop policy if exists host_all_sessions on sessions;
create policy host_all_sessions on sessions for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and (club_id is null or is_club_member(club_id)));

-- --- #2/#8 member session list via a column-scoped RPC (no whole row) ---
drop policy if exists club_members_read_sessions on sessions;

create or replace function get_club_sessions(p_club_id uuid)
returns table (
  id uuid, name text, status text, format text,
  created_at timestamptz, started_at timestamptz, ended_at timestamptz,
  public_token text, created_by uuid
) language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.status, s.format, s.created_at, s.started_at, s.ended_at,
         s.public_token, s.created_by
  from sessions s
  where s.club_id = p_club_id and s.status <> 'draft' and is_club_member(p_club_id)
  order by s.created_at desc;
$$;
grant execute on function get_club_sessions(uuid) to authenticated;

-- --- #8 stop platform-wide roster enumeration --------------------------
drop policy if exists club_members_read on club_members;
create policy club_members_read on club_members for select to authenticated
  using (is_club_member(club_id));

-- Discovery (member counts + my state) without exposing other clubs' rosters.
create or replace function search_clubs(p_query text)
returns table (
  id uuid, name text, club_code text, logo_url text,
  member_count bigint, is_member boolean, requested boolean
) language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.club_code, c.logo_url,
         (select count(*) from club_members m where m.club_id = c.id) as member_count,
         exists (select 1 from club_members m where m.club_id = c.id and m.user_id = auth.uid()) as is_member,
         exists (select 1 from club_join_requests r where r.club_id = c.id and r.user_id = auth.uid() and r.status = 'pending') as requested
  from clubs c
  where (coalesce(trim(p_query), '') = '' or c.name ilike '%' || p_query || '%')
  order by c.name
  limit 25;
$$;
grant execute on function search_clubs(text) to authenticated;

-- --- #7 pin search_path on the older SECURITY DEFINER functions --------
alter function is_session_host(uuid)   set search_path = public;
alter function is_round_host(uuid)     set search_path = public;
alter function is_match_host(uuid)     set search_path = public;
alter function get_public_session(text) set search_path = public;
alter function get_join_session(text)  set search_path = public;
alter function get_player_sessions()   set search_path = public;
alter function request_join(text, text, text, text, text, text) set search_path = public;

-- --- #6 owner succession on ANY membership removal ---------------------
-- Runs after a club_members row is deleted (member leaving, kick, OR account
-- deletion cascading profiles → club_members). If the departed row was the
-- owner, promote the longest-tenured admin (else longest-tenured member); if
-- nobody remains, delete the now-empty club.
create or replace function club_member_owner_succession()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_new_owner uuid;
begin
  if OLD.role = 'owner' then
    select user_id into v_new_owner from club_members
      where club_id = OLD.club_id and role = 'admin' order by joined_at asc limit 1;
    if v_new_owner is null then
      select user_id into v_new_owner from club_members
        where club_id = OLD.club_id order by joined_at asc limit 1;
    end if;
    if v_new_owner is null then
      delete from clubs where id = OLD.club_id;
    else
      update club_members set role = 'owner' where club_id = OLD.club_id and user_id = v_new_owner;
    end if;
  end if;
  return OLD;
end;
$$;

drop trigger if exists trg_club_owner_succession on club_members;
create trigger trg_club_owner_succession after delete on club_members
  for each row execute function club_member_owner_succession();

-- leave_club no longer runs succession itself (the trigger owns it) — otherwise
-- the two would double-promote and create two owners.
create or replace function leave_club(p_club_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from club_members where club_id = p_club_id and user_id = auth.uid();
  if v_role is null then raise exception 'You are not in this team.' using errcode = 'P0001'; end if;
  delete from club_members where club_id = p_club_id and user_id = auth.uid();
  -- succession handled by trg_club_owner_succession
end;
$$;
