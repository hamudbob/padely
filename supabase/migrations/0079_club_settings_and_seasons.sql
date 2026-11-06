-- ---------------------------------------------------------------------
-- 0079_club_settings_and_seasons.sql  (Phase 2)
--
-- 1. Club settings, set by the owner and admins on one screen:
--      join_mode         'approval' (default, as today) | 'open': the club
--                        code lets people in straight away
--      listed            false keeps the club out of search (members still
--                        see it; the code still works)
--      max_guests        0-3 per member per Call-up (3, as today)
--      waitlist_enabled  false: a full Call-up says "full" instead of queuing
--      reminder_minutes  60 (as today) | 120 | 0 = no reminder
--      callup_defaults   what a new Call-up form starts with
--      session_defaults  what a new club session starts with
--    league_min_sessions now matters again (the app had pinned it to 1); it
--    is set to 1 for every club so nothing changes until an admin says so.
--
-- 2. Seasons. club_season_rules: "from this date, seasons are N months".
--    Every club starts with one rule from 1 Jan 2000 at its current length,
--    which reproduces the calendar-aligned periods the league has always
--    used. A change of length starts at the end of the season in progress
--    (Hamud, 6 Nov 2026). clubs.league_period follows the rule in force,
--    updated daily, for app versions that read it directly.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

-- ── 1. Settings columns ────────────────────────────────────────────────
alter table clubs add column if not exists join_mode text not null default 'approval';
alter table clubs add column if not exists listed boolean not null default true;
alter table clubs add column if not exists max_guests int not null default 3;
alter table clubs add column if not exists waitlist_enabled boolean not null default true;
alter table clubs add column if not exists reminder_minutes int not null default 60;
alter table clubs add column if not exists callup_defaults jsonb not null default '{}'::jsonb;
alter table clubs add column if not exists session_defaults jsonb not null default '{}'::jsonb;

do $$ begin
  alter table clubs add constraint clubs_join_mode_check check (join_mode in ('approval', 'open'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clubs add constraint clubs_max_guests_check check (max_guests between 0 and 3);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clubs add constraint clubs_reminder_minutes_check check (reminder_minutes in (0, 60, 120));
exception when duplicate_object then null; end $$;

-- The app has shown everyone after one night since Sep 2026, whatever this
-- said. Make the column say the same, once; from now on admins set it.
do $$ begin
  if not exists (select 1 from pg_class where relname = 'club_season_rules') then
    update clubs set league_min_sessions = 1;
  end if;
end $$;
alter table clubs alter column league_min_sessions set default 1;

-- ── 2. Seasons ────────────────────────────────────────────────────────
create table if not exists club_season_rules (
  club_id   uuid not null references clubs(id) on delete cascade,
  starts_at timestamptz not null,
  length    text not null check (length in ('monthly','2_month','3_month','6_month','yearly')),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (club_id, starts_at)
);
alter table club_season_rules enable row level security;
drop policy if exists club_season_rules_read on club_season_rules;
create policy club_season_rules_read on club_season_rules for select to authenticated using (true);
grant select on club_season_rules to authenticated;

insert into club_season_rules (club_id, starts_at, length)
select id, '2000-01-01T00:00:00Z', league_period from clubs
on conflict do nothing;

-- New clubs get their first rule the moment they exist.
create or replace function trg_club_first_season_rule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into club_season_rules (club_id, starts_at, length)
  values (new.id, '2000-01-01T00:00:00Z', new.league_period)
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists club_first_season_rule on clubs;
create trigger club_first_season_rule after insert on clubs
  for each row execute function trg_club_first_season_rule();

-- clubs.league_period = the length in force now. Daily, and after a change.
create or replace function sync_league_periods() returns integer
language sql security definer set search_path = public as $$
  with cur as (
    select distinct on (club_id) club_id, length
      from club_season_rules where starts_at <= now()
     order by club_id, starts_at desc
  ), upd as (
    update clubs c set league_period = cur.length
      from cur where cur.club_id = c.id and c.league_period is distinct from cur.length
    returning 1
  )
  select count(*)::int from upd;
$$;
revoke all on function sync_league_periods() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled: clubs.league_period will not follow season changes until it is.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-league-periods') then
    perform cron.unschedule('sync-league-periods');
  end if;
  perform cron.schedule('sync-league-periods', '5 17 * * *', 'select public.sync_league_periods()');
end;
$$;

-- ── 3. Saving the settings screen ─────────────────────────────────────
-- One call for the whole screen. Every key is optional; what is absent is
-- left alone. p_settings.season_length with season_starts_at (the end of the
-- season in progress, worked out by the app) schedules a change of length.
create or replace function update_club_settings(p_club_id uuid, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s jsonb := coalesce(p_settings, '{}'::jsonb);
  v_len text;
  v_from timestamptz;
  v_in_force text;
begin
  if not (is_club_admin(p_club_id) or is_app_admin()) then
    raise exception 'Only the club''s owner and admins can change its settings.' using errcode = 'P0001';
  end if;

  if length(coalesce(s -> 'callup_defaults', '{}'::jsonb)::text) > 2000
     or length(coalesce(s -> 'session_defaults', '{}'::jsonb)::text) > 2000 then
    raise exception 'Those defaults are too long.' using errcode = 'P0001';
  end if;

  update clubs set
    join_mode           = coalesce(s ->> 'join_mode', join_mode),
    listed              = coalesce((s ->> 'listed')::boolean, listed),
    max_guests          = coalesce((s ->> 'max_guests')::int, max_guests),
    waitlist_enabled    = coalesce((s ->> 'waitlist_enabled')::boolean, waitlist_enabled),
    reminder_minutes    = coalesce((s ->> 'reminder_minutes')::int, reminder_minutes),
    league_min_sessions = coalesce(least(greatest((s ->> 'league_min_sessions')::int, 1), 20), league_min_sessions),
    default_sort        = case when s ->> 'default_sort' in ('pointsPerSession','totalPoints','winsPerSession','clubScore','rating')
                               then s ->> 'default_sort' else default_sort end,
    callup_defaults     = case when jsonb_typeof(s -> 'callup_defaults') = 'object' then s -> 'callup_defaults' else callup_defaults end,
    session_defaults    = case when jsonb_typeof(s -> 'session_defaults') = 'object' then s -> 'session_defaults' else session_defaults end,
    updated_at          = now()
  where id = p_club_id;

  v_len := s ->> 'season_length';
  if v_len is not null then
    if v_len not in ('monthly','2_month','3_month','6_month','yearly') then
      raise exception 'Not a season length.' using errcode = 'P0001';
    end if;
    v_from := (s ->> 'season_starts_at')::timestamptz;
    if v_from is null or v_from <= now() or v_from > now() + interval '13 months'
       or v_from <> date_trunc('month', v_from at time zone 'UTC') at time zone 'UTC' then
      raise exception 'A new season length starts on the first day of the next season.' using errcode = 'P0001';
    end if;
    insert into club_season_rules (club_id, starts_at, length)
      select p_club_id, '2000-01-01T00:00:00Z', league_period from clubs where id = p_club_id
      on conflict do nothing;
    -- One planned change at a time: the newest choice replaces the last.
    delete from club_season_rules where club_id = p_club_id and starts_at > now();
    select length into v_in_force from club_season_rules
     where club_id = p_club_id and starts_at <= v_from order by starts_at desc limit 1;
    if v_in_force is distinct from v_len then
      insert into club_season_rules (club_id, starts_at, length, created_by)
      values (p_club_id, v_from, v_len, auth.uid());
    end if;
  end if;

  return (select jsonb_build_object(
    'join_mode', join_mode, 'listed', listed, 'max_guests', max_guests,
    'waitlist_enabled', waitlist_enabled, 'reminder_minutes', reminder_minutes,
    'league_min_sessions', league_min_sessions, 'default_sort', default_sort,
    'callup_defaults', callup_defaults, 'session_defaults', session_defaults)
    from clubs where id = p_club_id);
end;
$$;
revoke all on function update_club_settings(uuid, jsonb) from public, anon;
grant execute on function update_club_settings(uuid, jsonb) to authenticated;

-- ── 4. Joining with the code: "open" lets people straight in ──────────
create or replace function join_club_by_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_club uuid; v_name text; v_req uuid; v_mode text;
begin
  if v_uid is null then raise exception 'Please sign in.' using errcode = 'P0001'; end if;
  select id, name, coalesce(join_mode, 'approval') into v_club, v_name, v_mode from clubs where club_code = upper(trim(p_code));
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
  -- 0079: a club set to "open" lets the code in straight away.
  if v_mode = 'open' then
    insert into club_members (club_id, user_id, role) values (v_club, v_uid, 'member')
      on conflict (club_id, user_id) do nothing;
    insert into notifications (user_id, type, title, body, data)
    select cm.user_id, 'club_joined', 'New member',
           coalesce((select display_name from profiles where id = v_uid), 'Someone') || ' joined ' || v_name || ' with the club code',
           jsonb_build_object('club_id', v_club, 'path', '/teams/' || v_club || '/members')
    from club_members cm where cm.club_id = v_club and cm.role in ('owner','admin') and cm.user_id <> v_uid;
    return jsonb_build_object('club_id', v_club, 'name', v_name, 'joined', true);
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

-- ── 5. Search: a club can stay out of it ──────────────────────────────
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
    -- 0079: a club can keep out of search; its members still find it.
    and (coalesce(c.listed, true)
         or exists (select 1 from club_members m where m.club_id = c.id and m.user_id = auth.uid()))
  order by c.name
  limit 25;
$$;

-- ── 6. Guests and the waiting list follow the club's settings ─────────
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
  -- 0079: a club without a waiting list says "full" instead.
  if v_resp = 'waitlist' and not v_waitlist then
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

-- ── 7. Reminders: 1 hour, 2 hours or none, per club ───────────────────
create or replace function send_event_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  e   record;
  v_n integer := 0;
begin
  for e in
    -- 0079: each club picks 1 hour, 2 hours, or no reminder. The same
    -- half-hour window as before, centred on the club's choice.
    select ev.*, c.reminder_minutes as lead from club_events ev
      join clubs c on c.id = ev.club_id
     where ev.status = 'scheduled'
       and ev.reminder_sent_at is null
       and coalesce(c.reminder_minutes, 60) > 0
       and ev.scheduled_at between now() + make_interval(mins => coalesce(c.reminder_minutes, 60) - 15)
                               and now() + make_interval(mins => coalesce(c.reminder_minutes, 60) + 15)
     for update of ev skip locked
  loop
    update club_events set reminder_sent_at = now() where id = e.id;
    insert into notifications (user_id, type, title, body, data)
    select r.user_id, 'event_reminder',
           e.title || case when coalesce(e.lead, 60) >= 120 then ' starts in 2 hours' else ' starts in an hour' end,
           to_char(e.scheduled_at at time zone 'Asia/Jakarta', 'HH24:MI') || coalesce(' · ' || e.location, ''),
           jsonb_build_object('event_id', e.id, 'club_id', e.club_id, 'path', '/e/' || e.id)
      from club_event_rsvps r
     where r.event_id = e.id and r.response = 'in';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
