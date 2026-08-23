-- ---------------------------------------------------------------------
-- 0048 — what a scheduled session actually is, and a waiting list.
--
-- An event used to be a title, a time and a place. A host planning a night
-- needs four more things, and every one of them is asked in the group chat
-- within a minute of the invite going out: how many courts, how long, how many
-- players, and how much. They live on the EVENT and are deliberately not wired
-- to session creation — you book courts before you know who's coming, and the
-- session gets its own courts when it starts.
--
-- The waiting list is the real work here. Twelve slots, thirteen people, and
-- the thirteenth should not be turned away — they should be told they're next.
--
--   * 'in' is capped by max_players. Over the cap, a request to join becomes
--     'waitlist' rather than an error: the client shows "Join waitlist" and the
--     person ends up somewhere real instead of nowhere.
--   * 'maybe' and 'out' never consume a slot. A maybe upgrading to 'in' takes
--     a free slot if there is one and joins the waitlist if there isn't —
--     which is why the upgrade goes through the same function as a fresh join.
--   * When someone who was 'in' leaves, the earliest waitlister is promoted
--     automatically and notified. Earliest by responded_at: the going list is
--     shown alphabetically, but a QUEUE has to be first-come.
--   * A host can promote or remove anyone. Promotion is allowed to exceed the
--     cap — the host knows something the number doesn't (he's bringing the
--     balls), and a cap that overrules the person running the night is just an
--     obstacle. The count then reads 13/12, honestly.
--
-- THE RACE. Two people tapping "In" on the twelfth slot at the same moment
-- must not both get in. set_event_rsvp takes a row lock on the event before it
-- counts, so the second one waits, counts twelve, and is waitlisted. This is
-- why the whole thing is one SECURITY DEFINER function and not a client-side
-- count followed by an upsert.
-- ---------------------------------------------------------------------

alter table club_events
  add column if not exists court_count    int,
  add column if not exists duration_hours numeric(3,1),
  add column if not exists max_players    int,
  add column if not exists cost           text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'club_events_court_count_check') then
    alter table club_events add constraint club_events_court_count_check
      check (court_count is null or court_count between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_events_duration_check') then
    alter table club_events add constraint club_events_duration_check
      check (duration_hours is null or (duration_hours > 0 and duration_hours <= 24));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_events_max_players_check') then
    alter table club_events add constraint club_events_max_players_check
      check (max_players is null or max_players between 2 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'club_events_cost_check') then
    alter table club_events add constraint club_events_cost_check
      check (cost is null or char_length(cost) <= 40);
  end if;
end $$;

-- 'waitlist' joins the three answers.
alter table club_event_rsvps drop constraint if exists club_event_rsvps_response_check;
alter table club_event_rsvps add constraint club_event_rsvps_response_check
  check (response in ('in', 'maybe', 'out', 'waitlist'));

-- --- promotion, shared by the member and host paths --------------------
create or replace function promote_next_waitlister(p_event_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_next uuid;
  v_ev   club_events%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found or v_ev.max_players is null then return null; end if;
  -- Only if a slot actually opened.
  if (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'in') >= v_ev.max_players then
    return null;
  end if;

  select user_id into v_next
    from club_event_rsvps
   where event_id = p_event_id and response = 'waitlist'
   order by responded_at asc
   limit 1;
  if v_next is null then return null; end if;

  update club_event_rsvps set response = 'in'
   where event_id = p_event_id and user_id = v_next;

  insert into notifications (user_id, type, title, body, data)
  values (
    v_next, 'event_promoted',
    'You''re in for ' || v_ev.title,
    'A place opened up. ' || to_char(v_ev.scheduled_at, 'Dy DD Mon at HH24:MI') ||
      coalesce(' · ' || v_ev.location, ''),
    jsonb_build_object('event_id', p_event_id, 'club_id', v_ev.club_id)
  );
  return v_next;
end;
$$;

-- --- the member path ---------------------------------------------------
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

-- --- the host path -----------------------------------------------------
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

revoke all on function set_event_rsvp(uuid, text) from anon;
revoke all on function event_set_member_rsvp(uuid, uuid, text) from anon;
revoke all on function promote_next_waitlister(uuid) from anon, authenticated;
grant execute on function set_event_rsvp(uuid, text) to authenticated;
grant execute on function event_set_member_rsvp(uuid, uuid, text) to authenticated;

comment on function set_event_rsvp(uuid, text) is
  'The caller answers an event. Takes a row lock on the event before counting, so a full session cannot be over-filled by two simultaneous taps; a request to join a full session becomes a waitlist place rather than an error. Leaving a full session promotes the earliest waitlister and notifies them.';
comment on function event_set_member_rsvp(uuid, uuid, text) is
  'A club admin sets someone else''s answer — promoting out of order or removing a player. May exceed max_players on purpose: the host outranks the cap.';

-- --- the public payload learns the new shape ---------------------------
-- Going stays alphabetical: it's a roster, and people look for a name.
-- The waitlist is ordered by responded_at, because it's a queue and the order
-- IS the information.
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
    'is_admin', exists (
      select 1 from club_members
       where club_id = v_ev.club_id and user_id = v_uid and role in ('owner', 'admin'))
  );
end;
$$;

grant execute on function get_public_event(uuid) to anon, authenticated;

-- --- scheduling learns the four new fields -----------------------------
-- The old five-argument signature is DROPPED rather than left beside the new
-- one: PostgREST resolves an RPC by argument names, and two candidates that
-- differ only by defaulted arguments make every call ambiguous
-- ("could not choose a best candidate function"). One function, one shape.
drop function if exists create_club_event(uuid, text, timestamptz, text, text);

create or replace function create_club_event(
  p_club_id uuid, p_title text, p_scheduled_at timestamptz,
  p_location text default null, p_notes text default null,
  p_court_count int default null, p_duration_hours numeric default null,
  p_max_players int default null, p_cost text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_club_admin(p_club_id) then
    raise exception 'Only admins can schedule sessions.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(trim(p_title), '')) = 0 then
    raise exception 'Give the session a title.' using errcode = 'P0001';
  end if;

  insert into club_events (club_id, title, scheduled_at, location, notes, created_by,
                           court_count, duration_hours, max_players, cost)
    values (p_club_id, trim(p_title), p_scheduled_at,
            nullif(trim(coalesce(p_location, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid(),
            p_court_count, p_duration_hours, p_max_players,
            nullif(trim(coalesce(p_cost, '')), ''))
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

grant execute on function create_club_event(uuid, text, timestamptz, text, text, int, numeric, int, text) to authenticated;

-- --- editing an event after the fact -----------------------------------
-- Numbers change: a court falls through, the venue puts the price up, someone
-- talks you into a fourth hour. Editing them shouldn't mean cancelling the
-- night and re-inviting everyone, which is what hosts do today.
-- If an earlier form of this function ever landed, drop it: two candidates
-- differing only by defaulted arguments make every PostgREST call ambiguous.
drop function if exists update_club_event(uuid, int, numeric, int, text, text);

create or replace function update_club_event(
  p_event_id uuid,
  p_title text default null, p_scheduled_at timestamptz default null,
  p_court_count int default null, p_duration_hours numeric default null,
  p_max_players int default null, p_cost text default null,
  p_location text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev club_events%rowtype; v_promoted uuid;
begin
  select * into v_ev from club_events where id = p_event_id for update;
  if not found then
    raise exception 'That session is no longer scheduled.' using errcode = 'P0002';
  end if;
  if not is_club_admin(v_ev.club_id) then
    raise exception 'Only admins can change a scheduled session.' using errcode = 'P0001';
  end if;

  -- Title and time are coalesced (null means "leave it"), because most edits
  -- touch one field. The four numbers are set outright, so clearing one is
  -- possible — "actually there's no cap" has to be expressible.
  update club_events set
    title          = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
    scheduled_at   = coalesce(p_scheduled_at, scheduled_at),
    court_count    = p_court_count,
    duration_hours = p_duration_hours,
    max_players    = p_max_players,
    cost           = nullif(trim(coalesce(p_cost, '')), ''),
    location       = coalesce(nullif(trim(coalesce(p_location, '')), ''), location)
  where id = p_event_id;

  -- Raising the cap should let the queue move immediately rather than waiting
  -- for someone to drop out. Lowering it never removes anyone (see header).
  loop
    v_promoted := promote_next_waitlister(p_event_id);
    exit when v_promoted is null;
  end loop;

  return jsonb_build_object(
    'in_count', (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'in'),
    'waitlist_count', (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'waitlist')
  );
end;
$$;

revoke all on function update_club_event(uuid, text, timestamptz, int, numeric, int, text, text) from anon;
grant execute on function update_club_event(uuid, text, timestamptz, int, numeric, int, text, text) to authenticated;

comment on function update_club_event(uuid, text, timestamptz, int, numeric, int, text, text) is
  'Admin edit of a scheduled session''s numbers. Raising max_players drains the waiting list immediately; lowering it never removes anyone already in.';
