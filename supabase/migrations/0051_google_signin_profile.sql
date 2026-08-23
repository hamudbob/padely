-- ---------------------------------------------------------------------
-- 0051  Make the new-user trigger understand a Google sign-in
--
-- handle_new_user() (0012) read the display name from raw_user_meta_data
-- ->> 'name', which is what our own sign-up form writes. Google's OIDC
-- profile arrives under 'full_name' as well, and carries a photo under
-- 'picture' / 'avatar_url'. Without this, the first Google account on the
-- app would land as "hamudbob" — the front of their email — with no photo,
-- and would have to retype a name Google already gave us.
--
-- Only ever fires on INSERT into auth.users, so it cannot overwrite a name
-- or avatar someone has since set themselves.
-- ---------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1),
      'Player'
    ),
    -- Google hands the photo over as an https URL we can render directly.
    -- Nothing is copied into our storage bucket: if the person later uploads
    -- their own, that overwrites this column and the Google URL is simply
    -- forgotten.
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
  'Creates the profile row for a new auth user. Reads name from our own sign-up (name) or from an OAuth profile (full_name), and seeds the avatar from a provider photo when one is offered.';
