-- ---------------------------------------------------------------------
-- 0055  A share link somebody can read out loud
--
-- /e/<uuid> cannot be said, remembered or retyped. This adds a slug built
-- from the session title, so the link a host pastes into a group chat is
-- padelier.id/e/pler-monday-sesh.
--
-- THREE THINGS THIS HAS TO GET RIGHT, all of them awkward to retrofit once
-- links are out in the world:
--
-- 1. A club runs "Monday Sesh" every week. The slug carries the date when
--    the bare one is taken — pler-monday-sesh-0902 — because the
--    alternative is every old link quietly pointing at whichever session
--    was created most recently, which is the worst way for a share link
--    to fail.
--
-- 2. The slug is written ONCE, at creation, and never derived on read.
--    Renaming a session must not break a link already sitting in
--    somebody's WhatsApp. The uuid route keeps working forever alongside
--    it, so links shared before this migration are unaffected.
--
-- 3. It keeps working after the night is over. Nothing here consults
--    status or date: an ended session's link still resolves and still
--    shows who played. A link that dies at midnight is not a share link,
--    it is a countdown.
--
-- Guessable by design. Hamud's call, 26 Aug: the going list is no more
-- private than any club page on any booking site, and a readable link is
-- worth more than an unguessable one.
-- ---------------------------------------------------------------------

alter table club_events add column if not exists slug text;

-- Unique across every club and all time. Not per-club: the slug is the whole
-- path, so two clubs with a "Monday Sesh" must not both claim it.
create unique index if not exists club_events_slug_key on club_events (slug) where slug is not null;

/** Title to url-safe stem: lowercase, spaces and punctuation to hyphens,
 *  collapsed, trimmed, capped. Nothing clever — a stem that survives being
 *  read down a phone is the whole requirement. */
create or replace function event_slug_stem(p_title text)
returns text language sql immutable as $$
  select nullif(
    left(
      btrim(
        regexp_replace(
          regexp_replace(lower(btrim(coalesce(p_title, ''))), '[^a-z0-9]+', '-', 'g'),
          '-+', '-', 'g'),
        '-'),
      48),
    '');
$$;

/** The first free slug for this title at this time.
 *
 *  Bare stem, then stem-DDMM, then stem-DDMM-2 upward. The date comes second
 *  rather than always, so the FIRST "Monday Sesh" gets the clean link and only
 *  the repeats carry a date — which is the right way round, because the clean
 *  one is the one people will try to guess. */
create or replace function event_slug_for(p_title text, p_when timestamptz)
returns text language plpgsql stable as $$
declare
  v_stem text := event_slug_stem(p_title);
  v_try  text;
  v_n    int := 2;
begin
  -- A title with no letters or digits in it at all ("!!!") leaves nothing to
  -- build from; the caller falls back to the uuid route.
  if v_stem is null then return null; end if;

  if not exists (select 1 from club_events where slug = v_stem) then
    return v_stem;
  end if;

  v_try := v_stem || '-' || to_char(coalesce(p_when, now()), 'DDMM');
  if not exists (select 1 from club_events where slug = v_try) then
    return v_try;
  end if;

  loop
    v_try := v_stem || '-' || to_char(coalesce(p_when, now()), 'DDMM') || '-' || v_n;
    exit when not exists (select 1 from club_events where slug = v_try);
    v_n := v_n + 1;
    -- Someone is doing something strange. Give up rather than spin; the uuid
    -- link still works and is what the caller falls back to.
    if v_n > 50 then return null; end if;
  end loop;
  return v_try;
end;
$$;

-- Backfill. Oldest first so the earliest session gets the clean slug, which is
-- the one most likely to have been shared already.
do $$
declare r record; v text;
begin
  for r in select id, title, scheduled_at from club_events where slug is null order by created_at loop
    v := event_slug_for(r.title, r.scheduled_at);
    if v is not null then
      update club_events set slug = v where id = r.id;
    end if;
  end loop;
end $$;

-- --- Creation and renaming ---------------------------------------------

-- A slug is assigned at creation and left alone afterwards. update_club_event
-- is deliberately NOT touched: renaming a session keeps its original link,
-- because that link is already in a group chat somewhere.
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
                           court_count, duration_hours, max_players, cost, slug)
    values (p_club_id, trim(p_title), p_scheduled_at,
            nullif(trim(coalesce(p_location, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid(),
            p_court_count, p_duration_hours, p_max_players,
            nullif(trim(coalesce(p_cost, '')), ''),
            event_slug_for(p_title, p_scheduled_at))
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

-- --- Reading by either kind of reference ---------------------------------

/** Resolve a slug OR a uuid to an event id. Both forever: the uuid links
 *  shared before this migration have to keep working, and so do the slugs
 *  after a session ends. Nothing here looks at status or date. */
create or replace function resolve_event_ref(p_ref text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(btrim(p_ref), '') = '' then return null; end if;

  -- A uuid is unambiguous, so try that shape first.
  begin
    v_id := btrim(p_ref)::uuid;
    if exists (select 1 from club_events where id = v_id) then return v_id; end if;
    return null;
  exception when invalid_text_representation then
    -- Not a uuid. Fall through and treat it as a slug.
  end;

  select id into v_id from club_events where slug = lower(btrim(p_ref));
  return v_id;
end;
$$;

/** The same public event payload, addressed by slug or uuid.
 *
 *  A separate overload rather than a change to get_public_event(uuid): that
 *  function is long, PostgREST picks by argument NAME, and rewriting a working
 *  function to add one lookup is how 0049 dropped five keys and broke the
 *  admin page. This one resolves and delegates. */
create or replace function get_public_event_by_ref(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_id uuid := resolve_event_ref(p_ref);
begin
  if v_id is null then return null; end if;
  return get_public_event(v_id);
end;
$$;

revoke all on function resolve_event_ref(text)      from anon;
revoke all on function get_public_event_by_ref(text) from anon;
grant execute on function resolve_event_ref(text)      to anon, authenticated;
grant execute on function get_public_event_by_ref(text) to anon, authenticated;

comment on column club_events.slug is
  'Readable share path, assigned once at creation and never rewritten — renaming a session must not break a link already in a group chat. Survives the session ending.';
