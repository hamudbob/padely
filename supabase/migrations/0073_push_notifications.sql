-- ---------------------------------------------------------------------
-- 0073_push_notifications.sql
--
-- Push notifications that actually get sent.
--
-- Everything for DELIVERY already existed: device tokens (0059), the send-push
-- Edge Function talking to APNs, the tap routing in the app. What was missing
-- was the "when". Nothing ever called send-push, so nobody ever got a
-- notification, however correctly their phone was registered.
--
-- ── One pipe ────────────────────────────────────────────────────────────
--
-- The app already writes an in-app notification row for most events (club
-- join requests, invites, a new session scheduled, off the waitlist). So the
-- push is hung off THAT table: every row inserted into `notifications` is
-- also pushed to the person's phone. One place to send from, the in-app list
-- and the lock screen always say the same thing, and every future
-- notification type is pushed without anyone remembering to wire it.
--
-- The send is pg_net (an HTTP call from the database, asynchronous, after
-- commit) to send-push, batched per statement: a session starting for twelve
-- people is one request carrying twelve user ids, not twelve requests. It is
-- wrapped so it can NEVER fail the transaction that created the notification
-- -- a broken push must not break an RSVP.
--
-- ── New events, in the order agreed ─────────────────────────────────────
--
--  1. Someone asks to join your session, or claims a spot  -> the host
--  2. Your session is live                                 -> its players
--  3. One hour before a club session                       -> who said "in"
--  4. Off the waitlist                                     (already written, 0048)
--  5. Final standings                                      -> its players
--  +  You were made co-host                                -> the co-host
--
-- ── Setup (once, in the SQL editor; the secret never goes in a chat) ────
--
--   insert into push_config (function_url, secret, anon_key) values (
--     'https://<project-ref>.supabase.co/functions/v1/send-push',
--     '<the PUSH_SEND_SECRET you set on the function>',
--     '<the project''s anon key>'   -- only needed if the function verifies JWTs
--   ) on conflict (id) do update set function_url = excluded.function_url,
--     secret = excluded.secret, anon_key = excluded.anon_key, enabled = true;
--
-- Additive & safe to re-run. Apply after 0072.
-- ---------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net is not available here (%). Notifications are still written in-app; enable pg_net to push them.', sqlerrm;
end;
$$;

-- --- 1. Configuration and a log, both sealed ---------------------------

create table if not exists push_config (
  id           smallint primary key default 1 check (id = 1),
  function_url text not null,
  secret       text not null,
  anon_key     text,
  enabled      boolean not null default true,
  -- Notification types not to push (they still appear in-app).
  muted_types  text[] not null default '{}',
  updated_at   timestamptz not null default now()
);
alter table push_config enable row level security;
revoke all on push_config from anon, authenticated;

create table if not exists push_log (
  id                bigserial primary key,
  created_at        timestamptz not null default now(),
  notification_type text,
  user_ids          uuid[],
  request_id        bigint,
  error             text
);
alter table push_log enable row level security;
revoke all on push_log from anon, authenticated;
create index if not exists push_log_created_idx on push_log (created_at desc);

-- --- 2. Where a tap goes -----------------------------------------------

-- An explicit data.path wins (every new type below sets one). Older types are
-- routed the way the in-app list routes them (NotificationsPage).
create or replace function notification_path(p_type text, p_data jsonb)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    nullif(p_data ->> 'path', ''),
    case
      when p_data ? 'public_token' then '/live/' || (p_data ->> 'public_token')
      when p_data ? 'event_id'     then '/e/' || (p_data ->> 'event_id')
      when p_type = 'invite'       then '/notifications'
      when p_data ? 'club_id'      then '/teams/' || (p_data ->> 'club_id')
      else '/notifications'
    end);
$$;

-- --- 3. The pipe: notifications -> send-push ---------------------------

create or replace function trg_push_notifications() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg     push_config%rowtype;
  g       record;
  v_req   bigint;
  v_heads jsonb;
begin
  select * into cfg from push_config where id = 1;
  if not found or not cfg.enabled then
    return null;
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    insert into push_log (notification_type, error) values ('*', 'pg_net is not installed');
    return null;
  end if;

  v_heads := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret);
  if cfg.anon_key is not null then
    v_heads := v_heads || jsonb_build_object('Authorization', 'Bearer ' || cfg.anon_key, 'apikey', cfg.anon_key);
  end if;

  for g in
    select n.type,
           n.title,
           coalesce(nullif(n.body, ''), 'Tap to open Padelier.') as body,
           notification_path(n.type, n.data)                     as path,
           array_agg(distinct n.user_id)                          as users
      from new_rows n
     where not (n.type = any (cfg.muted_types))
     group by 1, 2, 3, 4
  loop
    begin
      v_req := net.http_post(
        url     := cfg.function_url,
        body    := jsonb_build_object(
                     'userIds',    to_jsonb(g.users),
                     'title',      g.title,
                     'body',       g.body,
                     'path',       g.path,
                     'collapseId', left(g.type || ':' || g.path, 64)),
        params  := '{}'::jsonb,
        headers := v_heads,
        timeout_milliseconds := 10000);
      insert into push_log (notification_type, user_ids, request_id) values (g.type, g.users, v_req);
    exception when others then
      insert into push_log (notification_type, user_ids, error) values (g.type, g.users, sqlerrm);
    end;
  end loop;
  return null;
exception when others then
  -- Never let a push fail the RSVP, the join, the end of a session.
  return null;
end;
$$;
revoke all on function trg_push_notifications() from public, anon, authenticated;

drop trigger if exists notifications_push on notifications;
create trigger notifications_push
  after insert on notifications
  referencing new table as new_rows
  for each statement execute function trg_push_notifications();

-- --- 4. New sources -----------------------------------------------------

-- 1a. A player asks to join by code -> the host.
create or replace function trg_notify_join_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s sessions%rowtype;
begin
  if new.status <> 'pending' then return null; end if;
  select * into s from sessions where id = new.session_id;
  if not found or s.status = 'ended' then return null; end if;
  insert into notifications (user_id, type, title, body, data)
  values (s.created_by, 'session_join_request',
          new.display_name || ' wants to join',
          s.name || ' · tap to add them',
          jsonb_build_object('session_id', s.id, 'request_id', new.id, 'path', '/session/' || s.id || '/host'));
  return null;
end;
$$;
drop trigger if exists join_request_notify on join_requests;
create trigger join_request_notify after insert on join_requests
  for each row execute function trg_notify_join_request();

-- 1b. Someone claims a spot the host typed in -> the host.
create or replace function trg_notify_player_claim() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s        sessions%rowtype;
  v_who    text;
  v_player text;
begin
  if new.status <> 'pending' then return null; end if;
  select * into s from sessions where id = new.session_id;
  if not found then return null; end if;
  select display_name into v_who from profiles where id = new.claimant_user_id;
  select display_name into v_player from players where id = new.player_id;
  insert into notifications (user_id, type, title, body, data)
  values (s.created_by, 'claim_request',
          coalesce(v_who, 'Someone') || ' is claiming a spot',
          'Says they''re ' || coalesce(v_player, 'a player') || ' in ' || s.name,
          jsonb_build_object('session_id', s.id, 'claim_id', new.id, 'path', '/session/' || s.id || '/host'));
  return null;
end;
$$;
drop trigger if exists player_claim_notify on player_claims;
create trigger player_claim_notify after insert on player_claims
  for each row execute function trg_notify_player_claim();

-- +. Made co-host -> the co-host.
create or replace function trg_notify_co_host() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s      sessions%rowtype;
  v_host text;
begin
  if new.user_id = new.added_by then return null; end if;
  select * into s from sessions where id = new.session_id;
  if not found or s.status <> 'live' then return null; end if;
  select display_name into v_host from profiles where id = new.added_by;
  insert into notifications (user_id, type, title, body, data)
  values (new.user_id, 'co_host_added',
          'You''re co-host of ' || s.name,
          coalesce(v_host, 'The host') || ' made you co-host. Enter scores and start the next round.',
          jsonb_build_object('session_id', s.id, 'path', '/session/' || s.id || '/score'));
  return null;
end;
$$;
drop trigger if exists co_host_notify on session_scorers;
create trigger co_host_notify after insert on session_scorers
  for each row execute function trg_notify_co_host();

-- 2 & 5. Live, and ended. Deferred to the end of the transaction: the host's
-- push updates the session row FIRST and its players and matches after, so a
-- trigger firing at the update would see neither the players to tell nor the
-- final scores to tell them about.
alter table sessions add column if not exists started_notified_at timestamptz;
alter table sessions add column if not exists final_notified_at timestamptz;

-- Everyone with an account in the night, plus whoever said "in" to the club
-- session it was started from. Never the host.
create or replace function session_audience(p_session_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct u from (
    select p.linked_user_id as u
      from players p
     where p.session_id = p_session_id and p.linked_user_id is not null and p.status <> 'left'
    union
    select r.user_id
      from club_events e
      join club_event_rsvps r on r.event_id = e.id and r.response = 'in'
     where e.session_id = p_session_id
  ) x
  where u is not null
    and u <> (select created_by from sessions where id = p_session_id);
$$;
revoke all on function session_audience(uuid) from public, anon, authenticated;

create or replace function trg_notify_session_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s sessions%rowtype;
begin
  select * into s from sessions where id = new.id for update;
  if not found then return null; end if;

  -- Live, for the first time (a reopen is not a start).
  if s.status = 'live' and s.started_notified_at is null and s.reopened_at is null then
    update sessions set started_notified_at = now() where id = s.id;
    insert into notifications (user_id, type, title, body, data)
    select u, 'session_live',
           s.name || ' is live',
           'You''re on the list. Tap for your court and the standings.',
           jsonb_build_object('session_id', s.id, 'public_token', s.public_token, 'path', '/live/' || s.public_token)
      from session_audience(s.id) u;
  end if;

  -- Ended, once, and only if a match was actually played.
  if s.status = 'ended' and s.final_notified_at is null
     and exists (select 1 from matches m join rounds r on r.id = m.round_id
                  where r.session_id = s.id and m.status = 'final') then
    update sessions set final_notified_at = now() where id = s.id;
    insert into notifications (user_id, type, title, body, data)
    select u, 'session_final',
           'Final standings · ' || s.name,
           'See where you finished tonight.',
           jsonb_build_object('session_id', s.id, 'path', '/session/' || s.id || '/final')
      from session_audience(s.id) u;
  end if;
  return null;
end;
$$;

drop trigger if exists session_lifecycle_notify on sessions;
create constraint trigger session_lifecycle_notify
  after insert or update of status on sessions
  deferrable initially deferred
  for each row execute function trg_notify_session_lifecycle();

-- Sessions that already started or ended before this migration are not news.
update sessions set started_notified_at = coalesce(started_notified_at, started_at, now())
 where status in ('live', 'ended') and started_notified_at is null;
update sessions set final_notified_at = coalesce(final_notified_at, ended_at, now())
 where status = 'ended' and final_notified_at is null;

-- The old client-called "session started" broadcast to the whole club. It is
-- only reachable from a code path that no longer runs (local-first sessions
-- go live through sync_session_state), and the trigger above replaces it with
-- a message for the people actually playing. Kept callable, now a no-op, so
-- an old app calling it gets no error and nobody gets two messages.
create or replace function notify_club_session_started(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  return;
end;
$$;

-- 3. An hour before a club session -> whoever said "in".
alter table club_events add column if not exists reminder_sent_at timestamptz;

create or replace function send_event_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  e   record;
  v_n integer := 0;
begin
  for e in
    select * from club_events
     where status = 'scheduled'
       and reminder_sent_at is null
       and scheduled_at between now() + interval '45 minutes' and now() + interval '75 minutes'
     for update skip locked
  loop
    update club_events set reminder_sent_at = now() where id = e.id;
    insert into notifications (user_id, type, title, body, data)
    select r.user_id, 'event_reminder',
           e.title || ' starts in an hour',
           to_char(e.scheduled_at at time zone 'Asia/Jakarta', 'HH24:MI') || coalesce(' · ' || e.location, ''),
           jsonb_build_object('event_id', e.id, 'club_id', e.club_id, 'path', '/e/' || e.id)
      from club_event_rsvps r
     where r.event_id = e.id and r.response = 'in';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function send_event_reminders() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not enabled: hour-before reminders will not be sent until it is (Database -> Extensions), then re-run this file.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'event-reminders') then
    perform cron.unschedule('event-reminders');
  end if;
  perform cron.schedule('event-reminders', '*/5 * * * *', 'select public.send_event_reminders()');
end;
$$;

-- --- 5. Testing it from a phone ----------------------------------------

-- "Send me a test notification". One a minute per person.
create or replace function send_test_push()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_devices integer;
  v_config  boolean;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if exists (select 1 from notifications where user_id = v_uid and type = 'test'
              and created_at > now() - interval '1 minute') then
    raise exception 'One test a minute — try again shortly.' using errcode = 'P0001';
  end if;
  select count(*) into v_devices from device_tokens where user_id = v_uid and disabled_at is null;
  select exists (select 1 from push_config where id = 1 and enabled) into v_config;

  insert into notifications (user_id, type, title, body, data)
  values (v_uid, 'test', 'Notifications are on', 'This is what Padelier will send you. Tap to open settings.',
          jsonb_build_object('path', '/settings'));

  return jsonb_build_object('devices', v_devices, 'configured', v_config,
                            'pg_net', to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null);
end;
$$;
revoke all on function send_test_push() from public, anon;
grant execute on function send_test_push() to authenticated;

-- For the admin: is the pipe set up, and what did send-push answer lately?
create or replace function admin_push_status()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_log jsonb;
begin
  perform admin_guard();
  if to_regclass('net._http_response') is not null then
    execute $q$
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
        select l.created_at, l.notification_type, cardinality(l.user_ids) as users, l.error,
               r.status_code, left(r.content::text, 300) as response, r.error_msg
          from push_log l
          left join net._http_response r on r.id = l.request_id
         order by l.created_at desc limit 20) x $q$ into v_log;
  else
    select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) into v_log from (
      select created_at, notification_type, cardinality(user_ids) as users, error
        from push_log order by created_at desc limit 20) x;
  end if;
  return jsonb_build_object(
    'configured', exists (select 1 from push_config where id = 1 and enabled),
    'pg_net',     to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null,
    'pg_cron',    exists (select 1 from pg_extension where extname = 'pg_cron'),
    'devices',    (select count(*) from device_tokens where disabled_at is null),
    'my_devices', (select coalesce(jsonb_agg(jsonb_build_object(
                      'environment', environment, 'last_seen_at', last_seen_at)), '[]'::jsonb)
                     from device_tokens where user_id = auth.uid() and disabled_at is null),
    'log',        v_log);
end;
$$;
revoke all on function admin_push_status() from public, anon;
grant execute on function admin_push_status() to authenticated;
