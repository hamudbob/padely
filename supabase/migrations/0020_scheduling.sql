-- ---------------------------------------------------------------------
-- 0020_scheduling.sql  (Phase 3 — scheduled sessions + RSVP)
--
-- A club admin can schedule an upcoming session (a "club event"); members
-- RSVP in / maybe / out. When it's time, an admin starts the real session
-- from the event (the create wizard is pre-filled with the team + name).
--
-- club_events   — the planned session. Admins write; members read.
-- club_event_rsvps — one row per member per event. A member writes only their
--                    OWN response; any member of the club reads them all (so
--                    counts + the who's-coming list work).
--
-- Membership for the rsvp policies is checked THROUGH the event's club via a
-- small SECURITY DEFINER helper, so a member can't RSVP to an event outside a
-- club they belong to. Additive & safe to re-run.
-- ---------------------------------------------------------------------

create table if not exists club_events (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references clubs(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 80),
  scheduled_at timestamptz not null,
  location     text,
  notes        text,
  status       text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  session_id   uuid references sessions(id) on delete set null, -- set once the real session is started (future use)
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists club_events_club_time_idx on club_events (club_id, scheduled_at);

create table if not exists club_event_rsvps (
  event_id     uuid not null references club_events(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  response     text not null check (response in ('in','maybe','out')),
  responded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists club_event_rsvps_event_idx on club_event_rsvps (event_id);

-- Membership check via an event (used by the rsvp policies).
create or replace function is_event_club_member(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_events e where e.id = p_event_id and is_club_member(e.club_id)
  );
$$;
grant execute on function is_event_club_member(uuid) to authenticated;

alter table club_events enable row level security;
alter table club_event_rsvps enable row level security;

-- Events: members read; admins create/update (schedule, edit, cancel).
drop policy if exists club_events_read on club_events;
create policy club_events_read on club_events for select to authenticated
  using (is_club_member(club_id));

drop policy if exists club_events_admin_insert on club_events;
create policy club_events_admin_insert on club_events for insert to authenticated
  with check (is_club_admin(club_id));

drop policy if exists club_events_admin_update on club_events;
create policy club_events_admin_update on club_events for update to authenticated
  using (is_club_admin(club_id)) with check (is_club_admin(club_id));

drop policy if exists club_events_admin_delete on club_events;
create policy club_events_admin_delete on club_events for delete to authenticated
  using (is_club_admin(club_id));

-- RSVPs: any club member reads them all; a member writes ONLY their own row.
drop policy if exists club_event_rsvps_read on club_event_rsvps;
create policy club_event_rsvps_read on club_event_rsvps for select to authenticated
  using (is_event_club_member(event_id));

drop policy if exists club_event_rsvps_own_insert on club_event_rsvps;
create policy club_event_rsvps_own_insert on club_event_rsvps for insert to authenticated
  with check (user_id = auth.uid() and is_event_club_member(event_id));

drop policy if exists club_event_rsvps_own_update on club_event_rsvps;
create policy club_event_rsvps_own_update on club_event_rsvps for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists club_event_rsvps_own_delete on club_event_rsvps;
create policy club_event_rsvps_own_delete on club_event_rsvps for delete to authenticated
  using (user_id = auth.uid());
