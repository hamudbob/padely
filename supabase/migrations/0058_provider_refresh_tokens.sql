-- ---------------------------------------------------------------------
-- 0058  Keep Apple's refresh token, so deleting an account can tell Apple
--
-- WHY THIS TABLE EXISTS. App Store guideline 5.1.1(v), and Apple's own
-- announcement of it, are explicit: an app offering Sign in with Apple must
-- call Apple's REST API to revoke the user's tokens when they delete their
-- account. Deleting our side only is not enough.
--
-- 0037 already erases everything on our side properly. What it cannot do is
-- reach Apple, because revoking needs a refresh token that Apple issued —
-- and Supabase hands that token to the client EXACTLY ONCE, in the session
-- object at the moment of sign-in. It is never persisted and never appears
-- again. Miss it and the only way to get another is to make the person sign
-- in again, which is absurd to ask of someone who just pressed Delete.
--
-- So it is captured at sign-in and parked here until it is needed.
--
-- WHAT HAPPENS WITHOUT IT, concretely, because it is not obvious: the account
-- is deleted, but Padelier stays listed under the person's Apple ID. Their
-- next "Sign in with Apple" is a RE-authorization rather than a first one, so
-- Apple sends no name (it only ever sends that once), and they land in a
-- fresh empty account that Apple's own consent sheet still labels with their
-- name. It reads like the delete silently failed. Reviewers test this path.
--
-- ── Why there are no policies on this table ───────────────────────────────
--
-- This row is a credential. Not a dangerous one — Apple's refresh token can
-- refresh or revoke the Sign in with Apple grant and nothing else; it is not
-- a session and reveals nothing about the person — but it is still not ours
-- to leave lying where a client can reach it.
--
-- The first draft of this migration granted insert/update/delete to
-- `authenticated` with owner-only policies and NO select, so that not even
-- the owner could read their token back. Testing it killed that design in
-- two lines: `insert ... on conflict do update` and `delete ... where` both
-- require SELECT privilege on the table, so the client could write a token
-- once and then never update or clear it. Granting select back to make those
-- work would have handed every client a path to the tokens — the exact thing
-- the design existed to prevent.
--
-- So the table is sealed: RLS on, no policies, no grants to anon or
-- authenticated. Nothing signed in can see it or touch it. Writes go through
-- the security-definer function below, which decides for itself whose row it
-- is writing; reads happen only in the Edge Function, under the service role,
-- which bypasses RLS.
--
-- Idempotent: safe to run twice.
-- ---------------------------------------------------------------------

create table if not exists provider_refresh_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  provider      text        not null,
  refresh_token text        not null,
  updated_at    timestamptz not null default now()
);

comment on table provider_refresh_tokens is
  'OAuth refresh tokens captured at sign-in, kept solely so account deletion can revoke the grant with the provider (App Store guideline 5.1.1(v)). Sealed: written via store_provider_refresh_token(), read only by the service role.';

alter table provider_refresh_tokens enable row level security;

-- Belt and braces. RLS with no policies already denies everything to a
-- non-owner role; revoking the privileges too means a future migration that
-- adds a policy by mistake still cannot open the table by itself.
revoke all on provider_refresh_tokens from anon, authenticated;

-- If an earlier draft of this file was ever applied, its policies would still
-- be sitting there. Drop them by name so re-running this lands in the sealed
-- state rather than half of each design.
drop policy if exists prt_insert_own on provider_refresh_tokens;
drop policy if exists prt_update_own on provider_refresh_tokens;
drop policy if exists prt_delete_own on provider_refresh_tokens;

/**
 * Store the caller's provider refresh token.
 *
 * The caller does not get to say WHOSE token this is — auth.uid() decides,
 * and there is no parameter for it. That is the whole reason this is a
 * function rather than an upsert from the client.
 *
 * Called on every sign-in where the provider handed one over, so it overwrites
 * rather than accumulating. Apple issues a fresh refresh token each time and
 * the newest is the one that will still revoke cleanly.
 */
create or replace function store_provider_refresh_token(p_provider text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if p_token is null or length(trim(p_token)) = 0 then
    return; -- nothing to store; not an error worth surfacing at sign-in
  end if;

  insert into provider_refresh_tokens (user_id, provider, refresh_token, updated_at)
  values (v_uid, p_provider, p_token, now())
  on conflict (user_id) do update
    set provider      = excluded.provider,
        refresh_token = excluded.refresh_token,
        updated_at    = now();
end;
$$;

/**
 * Drop the caller's stored token.
 *
 * Not used by the delete flow — the Edge Function removes the row itself,
 * after it has actually revoked with Apple, so a failed revoke doesn't throw
 * away the only means of retrying it. This exists for the ordinary case of
 * signing out, where holding a provider credential we have no further use for
 * is simply untidy.
 */
create or replace function forget_provider_refresh_token()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  delete from provider_refresh_tokens where user_id = auth.uid();
end;
$$;

revoke execute on function store_provider_refresh_token(text, text) from anon;
revoke execute on function forget_provider_refresh_token() from anon;
grant  execute on function store_provider_refresh_token(text, text) to authenticated;
grant  execute on function forget_provider_refresh_token() to authenticated;

comment on function store_provider_refresh_token(text, text) is
  'Records the caller''s OAuth refresh token for later revocation on account deletion. The row is always the caller''s own — auth.uid() decides, not the caller.';
