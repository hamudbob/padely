-- ---------------------------------------------------------------------
-- 0057  Make the new-user trigger understand a Sign in with Apple
--
-- 0051 taught handle_new_user() to read Google's OIDC profile. Apple breaks
-- two assumptions that both Google and our own sign-up form satisfied, and
-- either one alone produces a visibly broken account.
--
-- 1. "HIDE MY EMAIL". Apple offers every user a relay address, and a lot of
--    people take it. It looks like this:
--
--        b8k2m9x4p7@privaterelay.appleid.com
--
--    Mail sent there really does reach them, so it is a genuine address and
--    belongs in auth.users untouched. But 0051's last-resort fallback is
--    split_part(email, '@', 1) — so the first Apple user to choose Hide My
--    Email would have been introduced to their club as "b8k2m9x4p7", and it
--    would have appeared on the league table, in the round cards, and in the
--    session recap image that gets shared to WhatsApp.
--
-- 2. THE NAME ARRIVES EXACTLY ONCE. Apple sends the display name only on the
--    very first authorization for an app, and never again. Google will hand
--    the profile over on every sign-in, so a missing name there is
--    recoverable; here it is not. There is no later call that fills it in.
--
--    Apple also sends it in pieces — givenName and familyName under a
--    'name' object — rather than as one string. Supabase normalises this to
--    'full_name' when it can, but not on every path, so we read the parts
--    directly as well rather than trusting one shape.
--
-- WHAT THIS CHANGES. Only the fallback chain inside handle_new_user(). Every
-- existing branch behaves exactly as it did — our own sign-up still wins on
-- 'name', Google still resolves through 'full_name' and 'picture'. The
-- additions are the two Apple name shapes, and a guard that refuses to derive
-- a name from a relay address.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It does not try to invent a nicer
-- placeholder than 'Player'. An Apple user with Hide My Email and no name
-- lands on /welcome like any other new account (profiles.needsOnboarding is
-- untouched), where they type a real name. 'Player' exists so that the
-- half-second before that screen is not embarrassing, not to be permanent.
--
-- Safe to run twice: create or replace, drop trigger if exists. Fires only on
-- INSERT into auth.users, so it can never overwrite a name or an avatar that
-- someone has since set for themselves.
-- ---------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Apple's two-part name, stitched back together. Either half may be absent;
  -- concat_ws drops nulls rather than leaving a stray space, and the nullif
  -- turns "both were missing" into a null the coalesce below can skip past.
  apple_name text := nullif(trim(concat_ws(
    ' ',
    nullif(trim(new.raw_user_meta_data -> 'name' ->> 'firstName'), ''),
    nullif(trim(new.raw_user_meta_data -> 'name' ->> 'lastName'), '')
  )), '');

  -- A relay address is a real, deliverable address — it stays in auth.users
  -- and we can mail it. It is only unfit to be READ, so the single thing we
  -- refuse to do with it is derive a display name from its local part.
  is_relay boolean := coalesce(new.email, '') ilike '%@privaterelay.appleid.com';
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      -- Our own sign-up form, which writes 'name' as a plain string.
      --
      -- THE TYPE CHECK IS NOT DEFENSIVE PADDING. Apple puts an OBJECT at
      -- 'name' ({"firstName":"Budi","lastName":"Santoso"}), and ->> on an
      -- object returns that object's JSON text rather than null. 0051 was
      -- written when only our own form used this key, so its first branch
      -- would have matched Apple's object, found it non-empty, and written
      --
      --     {"lastName": "Santoso", "firstName": "Budi"}
      --
      -- into display_name — onto the league table, the round cards and the
      -- shared recap image. Only take this branch when the value really is
      -- a string; Apple's object is handled by apple_name below.
      case
        when jsonb_typeof(new.raw_user_meta_data -> 'name') = 'string'
        then nullif(trim(new.raw_user_meta_data ->> 'name'), '')
      end,
      -- Google, and Apple when Supabase managed to normalise it.
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      -- Apple's givenName + familyName, when it did not.
      apple_name,
      -- The front of the email — but never a relay address's random local
      -- part. This is the whole point of the migration.
      case when is_relay then null else nullif(split_part(new.email, '@', 1), '') end,
      'Player'
    ),
    -- Unchanged from 0051. Apple sends no photo at all, so this simply
    -- resolves to null for an Apple account and the app falls back to its
    -- initials avatar, which is what it already does for anyone who has not
    -- uploaded one.
    nullif(trim(coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

comment on function handle_new_user() is
  'Creates the profile row for a new auth user. Reads name from our own sign-up (name), a Google/OIDC profile (full_name), or Apple''s two-part name object, and seeds the avatar from a provider photo when one is offered. Never derives a display name from an Apple private-relay address.';
