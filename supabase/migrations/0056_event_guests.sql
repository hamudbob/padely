-- ---------------------------------------------------------------------
-- 0056  Guests on a scheduled session
--
-- "Sometimes we bring friends." A club night is twelve places, and two of
-- them are regularly somebody's colleague who has never heard of this app.
-- Until now the only way to include them was to say nothing and let the
-- count read 10/12 while fourteen people stood on the court.
--
-- A guest is a NAME, not an account. No invite, no sign-up, no profile —
-- the whole point is that bringing someone should cost less effort than
-- not bringing them.
--
-- FOUR THINGS THIS HAS TO GET RIGHT
--
-- 1. A guest occupies a place. Every count, every cap check and the
--    waiting list all have to see them, or the feature quietly breaks the
--    one number the page exists to show. That is why this migration
--    rewrites four existing functions rather than adding a fifth: the cap
--    is only true if every path counts the same way.
--
-- 2. A guest can be waitlisted like anyone else, and is promoted in the
--    order they were added — competing fairly with members rather than
--    jumping them or being stuck behind them. The notification goes to
--    whoever brought them, since a guest has no account to notify.
--
-- 3. Guests carry a gender. Not decoration: Mix Americano refuses to
--    build a round without it, and a guest who arrives as an unknown
--    would either break the draw or be silently assumed male.
--
-- 4. Anyone in the club can bring someone, and it is recorded who. This is
--    a padel club, not an access-control problem — but "Rafa (guest of
--    Bagas)" is the difference between a name you can ask about and a name
--    nobody can account for. Three per person per night, which is more
--    than anyone needs and low enough that a mistake stays small.
-- ---------------------------------------------------------------------

create table if not exists club_event_guests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references club_events(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  gender       char not null default 'M' check (gender in ('M', 'F')),
  -- Who brought them. Kept on delete: if the member leaves the club the
  -- guest row stays valid, it just loses its attribution.
  invited_by   uuid references auth.users(id) on delete set null,
  response     text not null default 'in' check (response in ('in', 'waitlist')),
  created_at   timestamptz not null default now()
);

create index if not exists club_event_guests_event_idx on club_event_guests (event_id, response, created_at);

alter table club_event_guests enable row level security;

-- Readable by anyone who can see the event's club. Writes go through the
-- functions below, which is why there is no insert or update policy: the cap
-- and the per-member limit would be trivially bypassed by a direct insert.
drop policy if exists club_event_guests_read on club_event_guests;
create policy club_event_guests_read on club_event_guests for select
  using (exists (
    select 1 from club_events e
     where e.id = club_event_guests.event_id
       and is_club_member(e.club_id)
  ));

grant select on club_event_guests to authenticated;

-- --- one definition of "how full is this night" -------------------------

/** Members who are in, plus guests who are in.
 *
 *  Every cap check in this file goes through here. When the same number is
 *  computed in four places it eventually gets computed four ways — that is
 *  precisely how a "12 places" session ends up seating thirteen. */
create or replace function event_in_count(p_event_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select (select count(*) from club_event_rsvps  where event_id = p_event_id and response = 'in')
       + (select count(*) from club_event_guests where event_id = p_event_id and response = 'in');
$$;

-- --- adding and removing ------------------------------------------------

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

  select count(*) into v_mine
    from club_event_guests where event_id = p_event_id and invited_by = v_uid;
  if v_mine >= 3 then
    raise exception 'You can bring up to three guests to one session.' using errcode = 'P0001';
  end if;

  -- Full means the waiting list, not a refusal — exactly as it works for a
  -- member. A guest who never gets a place simply never gets one.
  v_resp := case
    when v_ev.max_players is null or event_in_count(p_event_id) < v_ev.max_players then 'in'
    else 'waitlist'
  end;

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

create or replace function remove_event_guest(p_guest_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_g   club_event_guests%rowtype;
  v_ev  club_events%rowtype;
  v_promoted uuid;
begin
  select * into v_g from club_event_guests where id = p_guest_id;
  if not found then return jsonb_build_object('removed', false); end if;
  select * into v_ev from club_events where id = v_g.event_id for update;

  -- The person who brought them, or a club admin. Not any member: a guest is
  -- somebody's responsibility, and anyone being able to remove anyone else's
  -- friend is a row waiting to happen in a group chat.
  if v_g.invited_by is distinct from v_uid
     and not exists (
       select 1 from club_members
        where club_id = v_ev.club_id and user_id = v_uid and role in ('owner', 'admin'))
     and not is_app_admin() then
    raise exception 'Only whoever brought this guest, or a club admin, can take them out.' using errcode = 'P0001';
  end if;

  delete from club_event_guests where id = p_guest_id;

  -- A place just opened, so it should be filled the same way any other
  -- opening is.
  if v_g.response = 'in' then
    v_promoted := promote_next_waitlister(v_g.event_id);
  end if;

  return jsonb_build_object('removed', true, 'in_count', event_in_count(v_g.event_id), 'promoted_user_id', v_promoted);
end;
$$;

-- --- the four functions that have to learn about guests -----------------
-- Each of these is its previous definition with the counting changed. They
-- are restated in full rather than patched, because a function is replaced
-- whole in Postgres — but nothing else in them has been touched.

-- A NOTE ON THE TIME IN THESE NOTIFICATIONS. to_char on a timestamptz renders
-- in the DATABASE's timezone, which is UTC — so every "a place opened up"
-- notification sent so far has quoted a 19:00 Jakarta session as 12:00. That
-- predates this migration; it is corrected here because these two lines are
-- being rewritten anyway. Hardcoding Asia/Jakarta is a stopgap, right for
-- every user there is today and wrong the moment there's a club abroad — the
-- real fix is a timezone on the club, and it belongs with the notification
-- work rather than here.
create or replace function promote_next_waitlister(p_event_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_next uuid;
  v_ev   club_events%rowtype;
  v_kind text;
  v_ref  uuid;
  v_guest club_event_guests%rowtype;
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found or v_ev.max_players is null then return null; end if;
  -- Only if a slot actually opened. Counts guests now.
  if event_in_count(p_event_id) >= v_ev.max_players then
    return null;
  end if;

  -- The earliest waiter, member or guest. Ordering across both rather than
  -- doing members first means a guest added at 9am isn't stuck behind a
  -- member who joined the queue at 6pm — the queue is a queue.
  select kind, ref into v_kind, v_ref from (
    select 'member' as kind, user_id as ref, responded_at as at
      from club_event_rsvps where event_id = p_event_id and response = 'waitlist'
    union all
    select 'guest' as kind, id as ref, created_at as at
      from club_event_guests where event_id = p_event_id and response = 'waitlist'
  ) q order by q.at asc limit 1;
  if v_kind is null then return null; end if;

  if v_kind = 'guest' then
    update club_event_guests set response = 'in' where id = v_ref;
    select * into v_guest from club_event_guests where id = v_ref;
    -- A guest has no account, so the news goes to whoever brought them.
    if v_guest.invited_by is not null then
      insert into notifications (user_id, type, title, body, data)
      values (
        v_guest.invited_by, 'event_promoted',
        v_guest.display_name || ' is in for ' || v_ev.title,
        'A place opened up for your guest. ' || to_char(v_ev.scheduled_at at time zone 'Asia/Jakarta', 'Dy DD Mon at HH24:MI') ||
          coalesce(' · ' || v_ev.location, ''),
        jsonb_build_object('event_id', p_event_id, 'club_id', v_ev.club_id)
      );
    end if;
    -- Deliberately null: the caller's contract is "which USER was promoted",
    -- and a guest is not one. Callers treat null as "nobody to announce".
    return null;
  end if;

  v_next := v_ref;
  update club_event_rsvps set response = 'in'
   where event_id = p_event_id and user_id = v_next;

  insert into notifications (user_id, type, title, body, data)
  values (
    v_next, 'event_promoted',
    'You''re in for ' || v_ev.title,
    'A place opened up. ' || to_char(v_ev.scheduled_at at time zone 'Asia/Jakarta', 'Dy DD Mon at HH24:MI') ||
      coalesce(' · ' || v_ev.location, ''),
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
    'in_count', event_in_count(p_event_id),
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
    'in_count', event_in_count(p_event_id),
    'promoted_user_id', v_promoted
  );
end;
$$;

-- get_public_event, with guests folded into the counts and the lists. Every
-- other key is exactly as 0052 left it: this function has been broken once
-- before by being rewritten from memory, so it is copied and extended, never
-- recalled.
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
      'in',       event_in_count(p_event_id),
      'maybe',    (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'maybe'),
      'out',      (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'out'),
      'waitlist', (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'waitlist')
                + (select count(*) from club_event_guests where event_id = p_event_id and response = 'waitlist')
    ),
    'going_names', coalesce(
      (select jsonb_agg(n order by n) from (
         select p.display_name as n from club_event_rsvps r join profiles p on p.id = r.user_id
          where r.event_id = p_event_id and r.response = 'in'
         union all
         select g.display_name from club_event_guests g
          where g.event_id = p_event_id and g.response = 'in'
       ) names),
      '[]'::jsonb),
    'going', coalesce(
      (select jsonb_agg(to_jsonb(x) order by x.name) from (
         select p.id::text as id, p.display_name as name, p.avatar_url as avatar,
                false as is_guest, null::text as guest_id, null::text as invited_by
           from club_event_rsvps r join profiles p on p.id = r.user_id
          where r.event_id = p_event_id and r.response = 'in'
         union all
         select 'guest:' || g.id::text, g.display_name, null,
                true, g.id::text, g.invited_by::text
           from club_event_guests g
          where g.event_id = p_event_id and g.response = 'in'
       ) x),
      '[]'::jsonb),
    'maybe', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url) order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'maybe'),
      '[]'::jsonb),
    'waitlist', coalesce(
      (select jsonb_agg(to_jsonb(x) order by x.at) from (
         select p.id::text as id, p.display_name as name, p.avatar_url as avatar,
                false as is_guest, null::text as guest_id, null::text as invited_by, r.responded_at as at
           from club_event_rsvps r join profiles p on p.id = r.user_id
          where r.event_id = p_event_id and r.response = 'waitlist'
         union all
         select 'guest:' || g.id::text, g.display_name, null,
                true, g.id::text, g.invited_by::text, g.created_at
           from club_event_guests g
          where g.event_id = p_event_id and g.response = 'waitlist'
       ) x),
      '[]'::jsonb),
    -- Who said no, by name. A host reads this list to know whether to chase
    -- anyone, and it stops "8 in" from being the only fact on the page.
    'out', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url) order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'out'),
      '[]'::jsonb),
    -- Guests as their own list too, so the create wizard can seed a session
    -- with their names AND their genders without re-parsing the going list.
    'guests', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', g.id, 'name', g.display_name, 'gender', g.gender,
                'response', g.response, 'invited_by', g.invited_by,
                'invited_by_name', (select display_name from profiles where id = g.invited_by))
              order by g.created_at)
         from club_event_guests g where g.event_id = p_event_id),
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

revoke all on function event_in_count(uuid)              from anon;
revoke all on function add_event_guest(uuid, text, text) from anon;
revoke all on function remove_event_guest(uuid)          from anon;
grant execute on function event_in_count(uuid)              to authenticated;
grant execute on function add_event_guest(uuid, text, text) to authenticated;
grant execute on function remove_event_guest(uuid)          to authenticated;

comment on table club_event_guests is
  'Someone a member is bringing who has no account. Counts toward max_players and takes a place in the waiting list like anybody else; carries a gender because the Mix formats cannot draw a round without one.';
comment on function event_in_count(uuid) is
  'Members in plus guests in — the single definition of how full a night is. Every cap check goes through here.';
