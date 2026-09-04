-- ---------------------------------------------------------------------
-- 0059  Device tokens for push notifications
--
-- One row per DEVICE, not per person. Someone with a phone and an iPad
-- should hear about a cancelled session on whichever one is in their hand,
-- and a household that shares an iPad should not have to choose.
--
-- ── Why `token` is the unique key, and not (user_id, token) ───────────────
--
-- A device token belongs to an app installation, not to an account. Sign out
-- on a phone and let a club-mate sign in on the same handset and APNs hands
-- back the SAME token — it identifies the install. If the table allowed the
-- pair to repeat, that phone would now be registered to two people, and the
-- first one would keep receiving the second one's session reminders. That is
-- not a leak of anything secret, but it is someone else's notifications on
-- your lock screen, which reads as a serious bug and feels like one.
--
-- Unique on the token alone makes re-registration a MOVE: whoever signed in
-- last owns the device, which is exactly the real-world truth.
--
-- ── Why environment is stored and not inferred ───────────────────────────
--
-- APNs is two separate services. A build run from Xcode registers with
-- sandbox (api.sandbox.push.apple.com); TestFlight and App Store builds
-- register with production (api.push.apple.com). The tokens are not
-- interchangeable and there is nothing in a token's text that says which it
-- is. Send a sandbox token to production and APNs answers BadDeviceToken —
-- a notification that simply never arrives, with no clue why.
--
-- So the app records which environment it built against, and the sender
-- trusts that rather than guessing. `aps-environment` in the entitlements is
-- the source of truth on the device.
--
-- ── Sealed, like 0058 ─────────────────────────────────────────────────────
--
-- RLS on, no policies, no grants. Writes go through the two security-definer
-- functions below; the sender reads under the service role. A device token is
-- not a credential in the usual sense — the worst someone could do with one
-- is send THAT device a notification, and only with our APNs key as well —
-- but it identifies a specific person's specific phone, and that is worth
-- keeping out of reach on its own.
--
-- Idempotent: safe to run twice.
-- ---------------------------------------------------------------------

create table if not exists device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  token        text        not null unique,
  platform     text        not null default 'ios' check (platform in ('ios', 'android')),
  environment  text        not null check (environment in ('sandbox', 'production')),
  -- Which app the token is for. APNs requires it as the `apns-topic` header,
  -- and hardcoding it in the sender would break the day a second app appears.
  bundle_id    text        not null,
  created_at   timestamptz not null default now(),
  -- Touched on every app open, so a device that has been silent for months
  -- can be told apart from one that was registered yesterday.
  last_seen_at timestamptz not null default now(),
  -- Set when APNs reports the token dead (410 Unregistered). Kept rather than
  -- deleted: "we stopped being able to reach this phone on 3 March" is the
  -- answer to "why didn't I get told", and a deleted row answers nothing.
  disabled_at  timestamptz
);

comment on table device_tokens is
  'APNs/FCM tokens, one row per device. Unique on token so re-registering moves the device to whoever signed in last. Sealed: written via register_device_token(), read by the service role.';

create index if not exists device_tokens_user_idx
  on device_tokens (user_id) where disabled_at is null;

alter table device_tokens enable row level security;
revoke all on device_tokens from anon, authenticated;

/**
 * Register (or re-register) the calling user's device.
 *
 * Called on every app open, not only the first. Tokens rotate — after an OS
 * update, a restore from backup, or a reinstall — and a stale one is not an
 * error we would otherwise notice, it is just silence.
 *
 * The conflict target is the token, so signing in on a phone that belonged to
 * someone else moves it. See the header for why that is the correct outcome.
 * `disabled_at` is cleared too: a token APNs rejected months ago that is now
 * being offered again by a live app is, by definition, alive.
 */
create or replace function register_device_token(
  p_token       text,
  p_platform    text,
  p_environment text,
  p_bundle_id   text
)
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
    return;
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'Unknown APNs environment: %', p_environment using errcode = 'P0001';
  end if;

  insert into device_tokens (user_id, token, platform, environment, bundle_id)
  values (v_uid, trim(p_token), coalesce(p_platform, 'ios'), p_environment, p_bundle_id)
  on conflict (token) do update
    set user_id      = v_uid,
        platform     = excluded.platform,
        environment  = excluded.environment,
        bundle_id    = excluded.bundle_id,
        last_seen_at = now(),
        disabled_at  = null;
end;
$$;

/**
 * Forget this device. Called on sign-out.
 *
 * Deletes rather than disables, because this is not a delivery failure — it
 * is someone saying "stop". Keeping the row to explain a silence nobody will
 * ask about is not worth holding a person's device identifier for.
 *
 * Not restricted to the caller's own rows on purpose: you can only pass a
 * token you are holding, which means you are the device, and a device is
 * entitled to unregister itself even if the row still names the previous
 * person who signed in on it.
 */
create or replace function unregister_device_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_token is null then
    return;
  end if;
  delete from device_tokens where token = trim(p_token);
end;
$$;

revoke execute on function register_device_token(text, text, text, text) from anon;
revoke execute on function unregister_device_token(text) from anon;
grant  execute on function register_device_token(text, text, text, text) to authenticated;
grant  execute on function unregister_device_token(text) to authenticated;

comment on function register_device_token(text, text, text, text) is
  'Records the caller''s device for push. Unique on token, so re-registering moves the device to the current user.';
