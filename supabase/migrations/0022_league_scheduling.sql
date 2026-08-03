-- ---------------------------------------------------------------------
-- 0022_league_scheduling.sql  (Phase 3 audit — league/scheduling polish)
--
--  #14  clubs.default_sort — the admin-set default column for the league board.
--  #15  create_club_event() — schedule a session AND notify every member
--       (moves event creation into a gated RPC, like the other club actions).
--  #17  join requests get a light cooldown after a decline (anti-spam).
-- Additive & safe to re-run.
-- ---------------------------------------------------------------------

alter table clubs add column if not exists default_sort text not null default 'pointsPerSession';

-- --- #15 schedule + notify -------------------------------------------
create or replace function create_club_event(
  p_club_id uuid, p_title text, p_scheduled_at timestamptz,
  p_location text default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_club_admin(p_club_id) then
    raise exception 'Only admins can schedule sessions.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(trim(p_title), '')) = 0 then
    raise exception 'Give the session a title.' using errcode = 'P0001';
  end if;

  insert into club_events (club_id, title, scheduled_at, location, notes, created_by)
    values (p_club_id, trim(p_title), p_scheduled_at,
            nullif(trim(coalesce(p_location, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    returning id into v_id;

  insert into notifications (user_id, type, title, body, data)
  select cm.user_id, 'session_scheduled', 'New session scheduled',
         trim(p_title) || ' · ' || to_char(p_scheduled_at, 'Dy DD Mon HH24:MI'),
         jsonb_build_object('club_id', p_club_id, 'event_id', v_id)
  from club_members cm
  where cm.club_id = p_club_id and cm.user_id <> auth.uid();

  return v_id;
end;
$$;
grant execute on function create_club_event(uuid, text, timestamptz, text, text) to authenticated;

-- --- #17 join-request cooldown after a decline -----------------------
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
  if exists (select 1 from club_join_requests
             where club_id = p_club_id and user_id = v_uid and status = 'declined'
               and decided_at > now() - interval '6 hours') then
    raise exception 'You can ask to join again a little later.' using errcode = 'P0001';
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
  if exists (select 1 from club_join_requests
             where club_id = v_club and user_id = v_uid and status = 'declined'
               and decided_at > now() - interval '6 hours') then
    raise exception 'You can ask to join again a little later.' using errcode = 'P0001';
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
