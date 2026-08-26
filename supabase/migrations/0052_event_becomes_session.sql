-- ---------------------------------------------------------------------
-- 0052  A scheduled session becomes the session being played
--
-- club_events.session_id has existed since 0020 marked "future use", and the
-- only thing that ever set it was the Start button on the club's own event
-- card. Start the same night any other way — from Play, from the home screen —
-- and the club page kept showing an RSVP form for a session already in play:
-- members could still switch themselves from in to out, which changed nothing
-- on court and contradicted the live scoreboard sitting one tab away.
--
-- Three parts:
--
-- 1. link_event_session / attach_session_to_event. The first is the explicit
--    link (the Start button), now server-side and admin-checked, and it clears
--    any other event pointing at the same session so one session can never be
--    claimed by two nights. The second is the safety net: called whenever a
--    club session goes live, it links the club's single scheduled unlinked
--    event within twelve hours either side of now. Exactly one candidate, or it
--    does nothing — a guess here would attach the wrong night's RSVPs to a
--    real session, which is worse than the problem being fixed.
--
-- 2. set_event_rsvp and event_set_member_rsvp refuse once the linked session is
--    live or ended.
--
-- 3. get_public_event returns the session, so /e/<id> can offer the scoreboard
--    instead of a form.
-- ---------------------------------------------------------------------

-- --- 1. Linking -------------------------------------------------------

create or replace function link_event_session(p_event_id uuid, p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_club uuid;
begin
  select club_id into v_club from club_events where id = p_event_id;
  if v_club is null then
    raise exception 'That session is no longer scheduled.' using errcode = 'P0002';
  end if;
  if not is_club_admin(v_club) and not is_app_admin() then
    raise exception 'Only a club admin can do that.' using errcode = 'P0001';
  end if;

  -- One session, one night. If this session was auto-attached to a different
  -- event a moment ago, that link goes.
  update club_events set session_id = null
   where club_id = v_club and session_id = p_session_id and id <> p_event_id;

  update club_events set session_id = p_session_id where id = p_event_id;
end;
$$;
revoke all on function link_event_session(uuid, uuid) from anon;
grant execute on function link_event_session(uuid, uuid) to authenticated;

create or replace function attach_session_to_event(p_session_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_club uuid;
  v_when timestamptz;
  v_event uuid;
  v_n int;
begin
  select club_id, coalesce(started_at, created_at) into v_club, v_when
    from sessions where id = p_session_id;
  if v_club is null then return null; end if;               -- not a club session
  if not is_club_admin(v_club) and not is_app_admin() then return null; end if;
  if exists (select 1 from club_events where session_id = p_session_id) then
    return null;                                            -- already linked
  end if;

  -- Candidates: this club's scheduled, unlinked events near this moment.
  -- Twelve hours either side covers a session started early, or one that runs
  -- past midnight, without reaching into next week.
  -- Counted and fetched separately: there is no min(uuid) in Postgres, and the
  -- count is the decision anyway.
  select count(*) into v_n
    from club_events
   where club_id = v_club
     and status = 'scheduled'
     and session_id is null
     and scheduled_at between v_when - interval '12 hours' and v_when + interval '12 hours';

  -- Two candidates means two nights planned close together, and picking one
  -- would attach the wrong roster. Do nothing; the Start button still works.
  if v_n <> 1 then return null; end if;

  select id into v_event
    from club_events
   where club_id = v_club
     and status = 'scheduled'
     and session_id is null
     and scheduled_at between v_when - interval '12 hours' and v_when + interval '12 hours'
   limit 1;

  update club_events set session_id = p_session_id where id = v_event;
  return v_event;
end;
$$;
revoke all on function attach_session_to_event(uuid) from anon;
grant execute on function attach_session_to_event(uuid) to authenticated;

-- --- 2. RSVPs close when the session opens ----------------------------

create or replace function set_event_rsvp(p_event_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_ev        club_events%rowtype;
  v_was       text;
  v_effective text;
  v_in_count  int;
  v_promoted  uuid;
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

  -- Once the night is actually being played, the roster belongs to the session,
  -- not to this list. Answering "in" or "out" here would change nothing on court
  -- and quietly contradict the scoreboard, so it is refused rather than accepted
  -- and ignored. See migration 0052.
  if v_ev.session_id is not null
     and exists (select 1 from sessions s
                  where s.id = v_ev.session_id and s.status in ('live', 'ended')) then
    raise exception 'That session has already started — the roster is on the live session now.'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from club_members where club_id = v_ev.club_id and user_id = v_uid) then
    raise exception 'Only club members can answer this.' using errcode = 'P0001';
  end if;

  select response into v_was from club_event_rsvps where event_id = p_event_id and user_id = v_uid;

  if p_response = 'in' then
    select count(*) into v_in_count
      from club_event_rsvps
     where event_id = p_event_id and response = 'in' and user_id <> v_uid;
    -- No cap, or room left: in. Otherwise the queue, not a refusal.
    v_effective := case
      when v_ev.max_players is null or v_in_count < v_ev.max_players then 'in'
      else 'waitlist'
    end;
  else
    v_effective := p_response;
  end if;

  insert into club_event_rsvps (event_id, user_id, response, responded_at)
  values (p_event_id, v_uid, v_effective, now())
  on conflict (event_id, user_id)
  do update set response = excluded.response, responded_at = excluded.responded_at;

  -- Someone stepping out of a full night hands their place on.
  if v_was = 'in' and v_effective <> 'in' then
    v_promoted := promote_next_waitlister(p_event_id);
  end if;

  return jsonb_build_object(
    'response', v_effective,
    'asked_for', p_response,
    'waitlisted', (v_effective = 'waitlist' and p_response = 'in'),
    'position', case when v_effective = 'waitlist' then (
      select count(*) from club_event_rsvps
       where event_id = p_event_id and response = 'waitlist'
         and responded_at <= (select responded_at from club_event_rsvps
                               where event_id = p_event_id and user_id = v_uid)
    ) end,
    'in_count', (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'in'),
    'promoted_user_id', v_promoted
  );
end;
$$;

create or replace function event_set_member_rsvp(p_event_id uuid, p_user_id uuid, p_response text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_ev       club_events%rowtype;
  v_was      text;
  v_promoted uuid;
begin
  if p_response not in ('in', 'maybe', 'out', 'waitlist') then
    raise exception 'Not a valid answer.' using errcode = 'P0001';
  end if;

  select * into v_ev from club_events where id = p_event_id for update;
  if not found then
    raise exception 'That session is no longer scheduled.' using errcode = 'P0002';
  end if;

  -- Once the night is actually being played, the roster belongs to the session,
  -- not to this list. Answering "in" or "out" here would change nothing on court
  -- and quietly contradict the scoreboard, so it is refused rather than accepted
  -- and ignored. See migration 0052.
  if v_ev.session_id is not null
     and exists (select 1 from sessions s
                  where s.id = v_ev.session_id and s.status in ('live', 'ended')) then
    raise exception 'That session has already started — the roster is on the live session now.'
      using errcode = 'P0001';
  end if;

  -- Club owner/admin, or an app admin doing a repair.
  if not exists (
    select 1 from club_members
     where club_id = v_ev.club_id and user_id = v_uid and role in ('owner', 'admin')
  ) and not is_app_admin() then
    raise exception 'Only a club admin can change someone else''s answer.' using errcode = 'P0001';
  end if;

  select response into v_was from club_event_rsvps where event_id = p_event_id and user_id = p_user_id;

  -- Note: a host promoting someone MAY exceed max_players. That is deliberate
  -- — see the header. The count then reads 13/12 rather than lying.
  insert into club_event_rsvps (event_id, user_id, response, responded_at)
  values (p_event_id, p_user_id, p_response, now())
  on conflict (event_id, user_id)
  do update set response = excluded.response, responded_at = excluded.responded_at;

  if v_was = 'in' and p_response <> 'in' then
    v_promoted := promote_next_waitlister(p_event_id);
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'response', p_response,
    'in_count', (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'in'),
    'promoted_user_id', v_promoted
  );
end;
$$;

-- --- 3. The shared page can see the live session ----------------------

create or replace function get_public_event(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ev club_events%rowtype; v_club clubs%rowtype; v_uid uuid := auth.uid();
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found then return null; end if;
  select * into v_club from clubs where id = v_ev.club_id;

  return jsonb_build_object(
    'id', v_ev.id,
    'club_id', v_ev.club_id,
    'team_name', v_club.name,
    'team_logo', v_club.logo_url,
    'title', v_ev.title,
    'scheduled_at', v_ev.scheduled_at,
    'location', v_ev.location,
    'status', v_ev.status,
    'court_count', v_ev.court_count,
    'duration_hours', v_ev.duration_hours,
    'max_players', v_ev.max_players,
    'cost', v_ev.cost,
    'counts', jsonb_build_object(
      'in',       (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'in'),
      'maybe',    (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'maybe'),
      'out',      (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'out'),
      'waitlist', (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'waitlist')
    ),
    'going_names', coalesce(
      (select jsonb_agg(p.display_name order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'in'),
      '[]'::jsonb),
    'going', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url) order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'in'),
      '[]'::jsonb),
    'maybe', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url) order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'maybe'),
      '[]'::jsonb),
    'waitlist', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url) order by r.responded_at)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'waitlist'),
      '[]'::jsonb),
    -- Who said no, by name. A host reads this list to know whether to chase
    -- anyone, and it stops "8 in" from being the only fact on the page.
    'out', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url) order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'out'),
      '[]'::jsonb),
    'my_response', (select response from club_event_rsvps where event_id = p_event_id and user_id = v_uid),
    'is_member', exists (select 1 from club_members where club_id = v_ev.club_id and user_id = v_uid),
    -- Null until a session is started from this event. The shared page reads
    -- it to swap the RSVP form for a way into the live scoreboard.
    'session', (
      select jsonb_build_object('id', s.id, 'status', s.status,
                                'public_token', s.public_token, 'join_code', s.join_code)
        from sessions s where s.id = v_ev.session_id
    ),
    'is_admin', exists (
      select 1 from club_members
       where club_id = v_ev.club_id and user_id = v_uid and role in ('owner', 'admin'))
  );
end;
$$;

comment on function attach_session_to_event(uuid) is
  'Best-effort link from a freshly-started club session back to the scheduled event it almost certainly is. Links only when exactly one candidate exists; returns the event id, or null when it declined.';
