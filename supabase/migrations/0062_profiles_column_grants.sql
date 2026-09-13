-- ---------------------------------------------------------------------
-- 0062  Stop any signed-in user from making themselves an app admin
--
-- THE BUG, and it is one HTTP request.
--
-- 0012 gave every authenticated user the right to update their own profile:
--
--     create policy profiles_update_own on profiles for update to authenticated
--       using (id = auth.uid()) with check (id = auth.uid());
--
-- That was correct when profiles held a name, an avatar and a rating. Then
-- 0041 added `is_admin boolean` to the same table, and 0037 added `deleted_at`.
--
-- RLS GATES ROWS, NEVER COLUMNS. The policy asks "is this your row?" and has no
-- opinion whatever about which columns you are changing. PostgREST is a
-- faithful proxy to the table, so:
--
--     PATCH /rest/v1/profiles?id=eq.<your own uuid>   {"is_admin": true}
--
-- passes the `with check` (it is genuinely your row) and makes the caller an
-- app admin. is_app_admin() reads that column, which unlocks admin_users and
-- therefore EVERY USER'S EMAIL ADDRESS, plus admin_set_admin,
-- admin_force_end_session, admin_reset_user_rating, the reports queue with
-- reporter identities, and the site-wide banner every visitor loads.
--
-- The same hole lets anyone set their own `rating` to 3000, or clear their own
-- `deleted_at` to undo an account deletion.
--
-- No trigger stood in the way: the only triggers in the schema are
-- on_auth_user_created (on auth.users) and trg_club_owner_succession (on
-- club_members). Nothing has ever guarded a profile update.
--
-- ── The fix, and why it is grants rather than a policy ──────────────────
--
-- A policy cannot express "these columns and not those" — that is exactly what
-- RLS does not do. Postgres has a separate mechanism for it, column-level
-- privileges, and this is the case it exists for. So we revoke the table-wide
-- write that `authenticated` holds by default and hand back only the columns a
-- person legitimately edits about themselves.
--
-- The RLS policy stays and still does its job: it decides WHICH ROW. The
-- grants decide WHICH COLUMNS. Both are needed, and neither substitutes for
-- the other.
--
-- ── Why this breaks nothing ────────────────────────────────────────────
--
-- The client writes profiles in exactly one place — updateMyProfile() in
-- src/lib/supabase/profileQueries.ts — and it sends id, display_name,
-- avatar_url, bio and updated_at. It uses upsert, which is INSERT ... ON
-- CONFLICT, so INSERT needs the same columns.
--
-- Everything else on this table is written by SECURITY DEFINER functions:
-- rating/rating_deviation/rating_volatility/rating_games by
-- apply_session_ratings (0041) and admin_credit_session_rating (0047),
-- onboarded_at by mark_onboarded (0035), deleted_at by the deletion path
-- (0037), stats server-side, is_admin by admin_set_admin (0041). A SECURITY
-- DEFINER function runs as the table's owner and is not affected by what
-- `authenticated` may do, so every one of those keeps working untouched.
--
-- SELECT is deliberately not narrowed here. profiles_read is `using (true)`,
-- which is its own (smaller) problem — any signed-in user can read the whole
-- user directory including who is an admin. That is a behaviour change for the
-- app's own screens and belongs in its own migration, not bundled into a
-- security fix that must be safe to apply immediately.
--
-- Idempotent: revoke and grant are both safe to run twice.
-- ---------------------------------------------------------------------

-- The table-wide default is what made this possible. Take it back first.
revoke insert, update on profiles from authenticated;

-- Then hand back precisely what a person edits about themselves.
-- `id` appears in BOTH grants, and the UPDATE one is not an oversight.
--
-- updateMyProfile() uses PostgREST's upsert, which compiles to
-- INSERT ... ON CONFLICT (id) DO UPDATE SET, and PostgREST puts every column of
-- the payload in that SET list — including the conflict target itself. Without
-- UPDATE on `id`, the whole statement is rejected with "permission denied for
-- table profiles" and NOBODY CAN EDIT THEIR PROFILE. Verified against Postgres
-- 16 before this file was written; it is not a theoretical concern.
--
-- Granting it costs nothing, because the RLS policy still has the final say:
-- `with check (id = auth.uid())` rejects any row whose id is not the caller's,
-- so the only value a user can write into their own id is the one already
-- there. Tested: the attempt fails with "new row violates row-level security
-- policy", not with success.
grant insert (id, display_name, avatar_url, bio, updated_at) on profiles to authenticated;
grant update (id, display_name, avatar_url, bio, updated_at) on profiles to authenticated;

-- anon has no business writing profiles at all.
revoke insert, update, delete on profiles from anon;

comment on column profiles.is_admin is
  'App-admin flag. NOT writable by `authenticated` — see 0062. Set only via admin_set_admin (SECURITY DEFINER). Any migration that regrants table-wide UPDATE on profiles reopens a privilege-escalation hole.';
