-- ---------------------------------------------------------------------
-- 0077 · Every account has a team, made by the database
--
-- 15 Oct 2026: a friend started a session from a club RSVP and nobody could
-- join it by code. The session never left their phone: every upload was
-- refused with "Could not find your team." (create_session_from_payload,
-- 0060), 40-odd times over the evening, and the lobby's own team lookup
-- failed with a 406 before that. The account had no teams row.
--
-- The team was only ever made by the app, on the login screen
-- (ensureHostTeam), and any failure there was swallowed on purpose so a
-- sign-in never looks broken. An account that got signed in any other way, or
-- whose one attempt failed, stayed team-less, and every session it hosted
-- stayed on the phone.
--
-- So the database makes it:
--   1. now, for every account that has none;
--   2. from here on, the moment an account is created.
-- The app's own call stays as a harmless second attempt (0044's unique index
-- turns a duplicate into a no-op).
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------

create or replace function ensure_team_for_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_name text;
begin
  select id into v_team from teams where owner_id = p_user_id order by created_at limit 1;
  if v_team is not null then
    return v_team;
  end if;

  select coalesce(
           nullif(trim(p.display_name), ''),
           nullif(split_part(u.email, '@', 1), ''),
           'My'
         )
    into v_name
    from auth.users u
    left join profiles p on p.id = u.id
   where u.id = p_user_id;

  if not found then
    return null;  -- no such account
  end if;

  insert into teams (owner_id, name)
  values (p_user_id, v_name || '''s Team')
  on conflict (owner_id) do nothing;

  select id into v_team from teams where owner_id = p_user_id order by created_at limit 1;
  return v_team;
end;
$$;

revoke all on function ensure_team_for_user(uuid) from public, anon, authenticated;

-- 2. From here on: at sign-up. A separate trigger from on_auth_user_created
-- (profiles, 0012/0051/0057), so neither migration has to know about the other.
-- After the profile trigger by name order ("on_auth_user_created" <
-- "on_auth_user_team"), so the team is named after the profile when there is one.
create or replace function trg_auth_user_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform ensure_team_for_user(new.id);
  exception when others then
    -- Never block a sign-up over a team row; the app and the next run of
    -- this file can still make it.
    raise warning 'team for % not created: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_team on auth.users;
create trigger on_auth_user_team
  after insert on auth.users
  for each row execute function trg_auth_user_team();

-- 1. Now: everyone without one.
select ensure_team_for_user(u.id)
  from auth.users u
 where not exists (select 1 from teams t where t.owner_id = u.id);
