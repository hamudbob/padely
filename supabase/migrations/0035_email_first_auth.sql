-- ---------------------------------------------------------------------
-- 0035_email_first_auth.sql
--
-- Supports the unified email-first sign-in / sign-up screen.
--
-- 1. email_exists() — the screen asks for an email, then becomes either a
--    log-in or a sign-up. That requires knowing whether the address already
--    has an account, which Supabase deliberately does not expose (telling a
--    stranger who is registered is an enumeration leak).
--
--    This is therefore a DELIBERATE, ACCEPTED trade-off: the same one Google
--    and Slack make to get this flow. It is mitigated, not eliminated:
--      - rate limited per client IP (30 probes / 10 minutes)
--      - returns only two booleans, never a name, id, or any profile data
--      - the probe log keeps only an IP and a timestamp, pruned hourly
--    If the leak ever stops being acceptable, revoke it from `anon` and the
--    client falls back to resolving on submit — the UI already handles a
--    failed lookup that way, so nothing breaks.
--
-- 2. profiles.onboarded_at — name / photo / position / gender are collected
--    AFTER email confirmation now, not during sign-up. This flag is what the
--    router gates on. Guessing from display_name would be ambiguous, since the
--    0012 trigger already defaults it to the email's local part.
--
-- 3. Pins search_path on lookup_guest — the one SECURITY DEFINER function the
--    0021 sweep missed (38 of 39 were pinned).
-- ---------------------------------------------------------------------

-- --- 2) Onboarding flag --------------------------------------------------
alter table profiles add column if not exists onboarded_at timestamptz;

-- Everyone who already has an account has already been through setup (or has
-- long since edited their profile), so nobody existing gets shown the new
-- welcome screen. Only accounts created from here on will have a null.
update profiles set onboarded_at = coalesce(onboarded_at, created_at, now())
 where onboarded_at is null;

-- Mark the caller's own onboarding as finished. A plain profiles UPDATE would
-- work under RLS, but going through a function keeps "finished onboarding" a
-- single explicit action rather than a column any screen might write.
create or replace function complete_onboarding()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  update profiles set onboarded_at = now(), updated_at = now()
   where id = auth.uid() and onboarded_at is null;
end;
$$;

grant execute on function complete_onboarding() to authenticated;

-- --- 1) Rate-limited email existence probe -------------------------------

-- Only ever holds an IP and a timestamp — no emails. Logging which addresses
-- were probed would create exactly the harvestable list this function is trying
-- not to hand out.
create table if not exists auth_probe_log (
  id         bigserial primary key,
  ip         text not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_probe_log_ip_idx on auth_probe_log (ip, created_at desc);

-- No policies: nothing but the SECURITY DEFINER function below may touch this,
-- and RLS with zero policies denies everyone else by default.
alter table auth_probe_log enable row level security;

create or replace function email_exists(p_email text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_ip     text;
  v_recent integer;
  v_confirmed timestamptz;
  v_found  boolean := false;
begin
  -- Cheap shape gate. The client validates properly; this just stops the
  -- function being used as a generic scanner with junk input.
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'A valid email address is required.' using errcode = 'P0001';
  end if;

  -- PostgREST forwards the request headers as a GUC, so we can see the real
  -- client address behind Supabase's proxy. Falls back to a shared bucket if
  -- the header is missing, which fails closed (stricter), not open.
  v_ip := coalesce(
    nullif(split_part(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1
    ), ''),
    'unknown'
  );

  -- Opportunistic pruning: ~1 call in 20 clears the old rows, so the table
  -- stays small without a scheduled job or an extension.
  if random() < 0.05 then
    delete from auth_probe_log where created_at < now() - interval '1 hour';
  end if;

  select count(*) into v_recent
    from auth_probe_log
   where ip = v_ip and created_at > now() - interval '10 minutes';

  if v_recent >= 30 then
    raise exception 'Too many attempts. Please wait a few minutes.' using errcode = 'P0001';
  end if;

  insert into auth_probe_log (ip) values (v_ip);

  -- Two booleans and nothing else. `confirmed` matters because an existing but
  -- unconfirmed account needs "we already emailed you a link" rather than
  -- either a password prompt or a fresh sign-up.
  select u.email_confirmed_at into v_confirmed
    from auth.users u
   where lower(u.email) = v_email
     and u.deleted_at is null
   limit 1;

  v_found := found;

  return jsonb_build_object(
    'exists', v_found,
    'confirmed', v_found and v_confirmed is not null
  );
end;
$$;

-- anon needs this: the whole point is that a not-yet-signed-in visitor types
-- their email and the screen decides which form to show.
grant execute on function email_exists(text) to anon, authenticated;

-- --- 3) Audit follow-up: the one unpinned SECURITY DEFINER function -----
alter function lookup_guest(text) set search_path = public;
