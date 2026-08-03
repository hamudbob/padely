-- ---------------------------------------------------------------------
-- 0017_club_logos.sql  (Phase 2 tidy-up — team logos)
--
-- A public-read `club-logos` Storage bucket. A club's admins may write files
-- only under that club's own folder ("<club_id>/logo.jpg"), enforced by
-- is_club_admin() on the folder name. Additive & safe to re-run.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('club-logos', 'club-logos', true)
on conflict (id) do nothing;

drop policy if exists "club logos public read" on storage.objects;
create policy "club logos public read" on storage.objects
  for select using (bucket_id = 'club-logos');

drop policy if exists "club logos admin insert" on storage.objects;
create policy "club logos admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'club-logos' and is_club_admin(((storage.foldername(name))[1])::uuid));

drop policy if exists "club logos admin update" on storage.objects;
create policy "club logos admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'club-logos' and is_club_admin(((storage.foldername(name))[1])::uuid));

drop policy if exists "club logos admin delete" on storage.objects;
create policy "club logos admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'club-logos' and is_club_admin(((storage.foldername(name))[1])::uuid));
