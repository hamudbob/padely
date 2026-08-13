-- ---------------------------------------------------------------------
-- 0037_account_deletion.sql
--
-- "Delete my account", done in the only way that doesn't destroy other
-- people's history.
--
-- WHY NOT `delete from auth.users`:
--   It wouldn't even run — sessions.created_by is ON DELETE RESTRICT, and
--   players.linked_user_id, score_edits.edited_by, adjustments.applied_by and
--   audit_events.actor_id are all NO ACTION. And if those were relaxed, the
--   teams.owner_id cascade would take every session the person ever hosted with
--   them: rounds, matches, match_participants, session_results. Every OTHER
--   player at those sessions would silently lose their record, because
--   get_public_profile computes W/L/D and form live from those same match rows,
--   and apply_session_results is once-only, so the league rows can never be
--   regenerated. One person leaving would quietly rewrite a whole club's history.
--
-- WHAT THIS DOES INSTEAD — erase the identity, keep the anonymous record:
--   Name, photo, bio, cached stats, email, password, auth identity and login
--   sessions are all destroyed. What remains is scores attached to "Deleted
--   player", which no longer identify anybody — the standard reading of the
--   erasure right, and the same trade-off the privacy policy states in plain
--   words so the two can't drift apart.
--
-- The auth.users ROW survives (blanked and banned) purely as a foreign-key
-- anchor. It holds nothing about the person by the time this returns.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

-- Marks the profile as retired so the app can tell "anonymous" from "quiet".
alter table profiles add column if not exists deleted_at timestamptz;

create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;

  select email into v_email from auth.users where id = v_uid;

  -- 1. The public identity ------------------------------------------------
  update profiles
     set display_name = 'Deleted player',
         avatar_url   = null,
         bio          = null,
         stats        = null,
         deleted_at   = now(),
         updated_at   = now()
   where id = v_uid;

  -- 2. Their name and email inside sessions --------------------------------
  -- Both the rows linked to the account and the guest rows matched by email,
  -- because someone who played as a guest before signing up has both.
  update players
     set display_name = 'Deleted player',
         email        = null
   where linked_user_id = v_uid;

  if v_email is not null then
    update players
       set display_name = 'Deleted player',
           email        = null
     where email is not null and lower(email) = lower(v_email);

    update join_requests
       set display_name = 'Deleted player',
           email        = null
     where email is not null and lower(email) = lower(v_email);
  end if;

  -- Lobbies they never started are pure roster — other people's names typed in
  -- but no matches played, so nothing is lost by removing them outright.
  delete from sessions where created_by = v_uid and status = 'draft';

  -- 3. Rows that are only about them ---------------------------------------
  delete from notifications      where user_id    = v_uid;
  delete from club_join_requests where user_id    = v_uid;
  delete from club_invites       where invitee_id = v_uid;
  update club_invites set inviter_id = null where inviter_id = v_uid;
  update club_join_requests set decided_by = null where decided_by = v_uid;

  -- Fires trg_club_owner_succession: promotes a new owner, or deletes the club
  -- outright if this was the last member. Both are the right outcome.
  delete from club_members where user_id = v_uid;

  -- 4. The credentials -----------------------------------------------------
  -- identities carries a copy of the email in identity_data, so it has to go
  -- too; sessions/refresh tokens go so no live token outlives this call.
  delete from auth.identities where user_id = v_uid;

  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using v_uid;
  end if;
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1::text' using v_uid;
  end if;

  update auth.users
     set email              = null,
         phone              = null,
         raw_user_meta_data = '{}'::jsonb,
         encrypted_password = null,
         email_change       = '',
         updated_at         = now()
   where id = v_uid;

  -- Columns that exist in current GoTrue but not in every older one — set them
  -- only if they're there, so this migration can't fail on a version skew.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'deleted_at'
  ) then
    execute 'update auth.users set deleted_at = now() where id = $1' using v_uid;
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until'
  ) then
    execute $q$update auth.users set banned_until = 'infinity'::timestamptz where id = $1$q$ using v_uid;
  end if;
end;
$$;

revoke execute on function delete_my_account() from anon;
grant  execute on function delete_my_account() to authenticated;

comment on function delete_my_account() is
  'Erases the caller''s identity (profile, name, email, password, auth identity) and keeps match rows as anonymous records. See 0037 for why a hard delete is not used.';
