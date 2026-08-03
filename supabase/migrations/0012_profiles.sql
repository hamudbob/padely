-- ---------------------------------------------------------------------
-- 0012_profiles.sql  (Phase 1, increment 2)
--
-- A real per-account profile: the lasting identity a player carries across
-- every session — display name, avatar, and their persisted GLOBAL skill
-- rating (Glicko-2 state) + a cached-stats blob for insights. Today the name
-- lives only in auth metadata, which can't hold an avatar or be referenced by
-- a team/leaderboard; this table fixes that.
--
-- Also provisions the `avatars` Storage bucket (public-read; a user may only
-- write files under their own <uid>/ folder).
--
-- Additive & safe to re-run.
-- ---------------------------------------------------------------------

create table if not exists profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  display_name       text not null default 'Player',
  avatar_url         text,
  -- Persisted Glicko-2 state (see src/lib/rating/glicko2.ts). Global, never resets.
  rating             numeric not null default 1500,
  rating_deviation   numeric not null default 350,
  rating_volatility  numeric not null default 0.06,
  rating_games       integer not null default 0,
  -- Cached insights (win rate, best partner, etc.) — populated at session end
  -- in a later increment so the profile screen never recomputes from raw history.
  stats              jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table profiles enable row level security;

-- Any signed-in user can read any profile (non-sensitive identity: name, avatar,
-- rating — used across leaderboards & teammate lists). No email here; email
-- stays in auth only. A user may only create/update their OWN row.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (true);

drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Auto-create a profile row whenever an auth user is created.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1), 'Player')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill profiles for users who already exist.
insert into public.profiles (id, display_name)
select u.id, coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1), 'Player')
from auth.users u
on conflict (id) do nothing;

-- --- Avatars storage bucket -------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read (avatars are public images); each user may only write files
-- under a folder named by their own uid (e.g. "<uid>/avatar.jpg").
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
