-- ---------------------------------------------------------------------
-- 0063  A rate limiter that works, and a second thing to point it at
--
-- TWO PROBLEMS, and the first is that the fix we already had was decorative.
--
-- ── 1. The X-Forwarded-For bug ─────────────────────────────────────────
--
-- 0035 rate-limits email_exists to 30 calls per IP per 10 minutes, and reads
-- the IP like this:
--
--     split_part(headers ->> 'x-forwarded-for', ',', 1)
--
-- That takes the LEFTMOST value. Proxies APPEND to X-Forwarded-For, so the
-- leftmost entry is not the client — it is whatever the client typed into the
-- header before sending. An attacker adds
--
--     X-Forwarded-For: <fresh random value>
--
-- to every request and gets a fresh 30-call bucket each time. The limit was
-- unenforceable, which mattered because it was the only limit in the codebase.
--
-- The rightmost entry is the one appended by the proxy nearest us, which a
-- client cannot forge. Better still is cf-connecting-ip, set by Cloudflare in
-- front of Supabase and not client-settable at all, so we prefer it and fall
-- back to the rightmost XFF.
--
-- ── 2. Nothing else was limited at all ─────────────────────────────────
--
-- Supabase rate-limits /auth/v1/* for free. It rate-limits /rest/v1/* on no
-- plan whatsoever. Every RPC in this app is a /rest/v1/ call, so the only
-- protection is protection we write, and we had written it once.
--
-- get_join_session takes a SIX DIGIT code — 900,000 values — is granted to
-- anon, and had no limit, no lockout and no logging. At a request rate that
-- would not trouble anyone, the whole space sweeps in about 75 minutes, and
-- because it filters on status in ('draft','live') a single sweep returns every
-- session open at that moment. Each hit hands back the public_token, so the
-- 32-character token is not a second factor: feed it to get_public_session and
-- you have every player's real name.
--
-- ── The shape of the fix ───────────────────────────────────────────────
--
-- Rather than copy 0035's inline logic to a second site (and copy its bug), the
-- IP read and the limit check become two small functions that any RPC can call.
-- auth_probe_log gains a `scope` column so one table serves every limiter
-- without them sharing a budget.
--
-- The budgets differ on purpose:
--   email_exists     30 / 10 min — a person may retype an address a few times
--   get_join_session 12 / 10 min — a person types one code, maybe twice
--
-- Idempotent. Safe to run twice.
-- ---------------------------------------------------------------------

-- ── The log gains a scope ─────────────────────────────────────────────
-- Existing rows are all email_exists probes, which is what the default says.
alter table auth_probe_log add column if not exists scope text not null default 'email_exists';
create index if not exists auth_probe_log_scope_ip_idx on auth_probe_log (scope, ip, created_at desc);

-- ── Reading the caller's address, correctly ───────────────────────────
create or replace function client_ip()
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_headers json;
  v_xff     text;
  v_parts   text[];
begin
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  if v_headers is null then
    -- No headers at all: not a PostgREST request (psql, a trigger, a test).
    -- Fail CLOSED to a shared bucket rather than open to a per-caller one.
    return 'unknown';
  end if;

  -- Cloudflare sets this in front of Supabase and a client cannot forge it,
  -- because anything the client sends under this name is overwritten.
  if coalesce(v_headers ->> 'cf-connecting-ip', '') <> '' then
    return v_headers ->> 'cf-connecting-ip';
  end if;

  v_xff := coalesce(v_headers ->> 'x-forwarded-for', '');
  if v_xff = '' then
    return 'unknown';
  end if;

  -- RIGHTMOST, not leftmost. Proxies append, so the last entry was written by
  -- the hop closest to us; everything to its left may have come from the
  -- client. This is the whole point of the migration.
  v_parts := string_to_array(v_xff, ',');
  return coalesce(nullif(btrim(v_parts[array_length(v_parts, 1)]), ''), 'unknown');
end;
$$;

-- ── One limiter, reusable ─────────────────────────────────────────────
-- Raises on refusal rather than returning a boolean, so a caller cannot
-- forget to check the result. Records the attempt only when it is allowed;
-- a refused caller hammering the endpoint does not grow the table.
create or replace function rate_limit_hit(p_scope text, p_limit int, p_window interval)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_ip     text := client_ip();
  v_recent integer;
begin
  -- Opportunistic pruning, as 0035 did: ~1 call in 20 clears old rows, so the
  -- table stays small with no scheduled job and no extension.
  if random() < 0.05 then
    delete from auth_probe_log where created_at < now() - interval '1 hour';
  end if;

  select count(*) into v_recent
    from auth_probe_log
   where scope = p_scope and ip = v_ip and created_at > now() - p_window;

  if v_recent >= p_limit then
    raise exception 'Too many attempts. Please wait a few minutes.' using errcode = 'P0001';
  end if;

  insert into auth_probe_log (ip, scope) values (v_ip, p_scope);
end;
$$;

revoke execute on function client_ip()                       from anon, authenticated;
revoke execute on function rate_limit_hit(text, int, interval) from anon, authenticated;

-- ── email_exists, with the IP read fixed ──────────────────────────────
-- Body unchanged from 0035 apart from delegating the limit. Two booleans out,
-- no email ever logged.
create or replace function email_exists(p_email text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_confirmed timestamptz;
  v_found     boolean := false;
begin
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'A valid email address is required.' using errcode = 'P0001';
  end if;

  perform rate_limit_hit('email_exists', 30, interval '10 minutes');

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

grant execute on function email_exists(text) to anon, authenticated;

-- ── get_join_session, now throttled ───────────────────────────────────
-- Was STABLE, which cannot write, so it becomes VOLATILE to record the
-- attempt. The client calls it through supabase.rpc(), which POSTs, so
-- PostgREST is unaffected by the volatility change.
--
-- 0021 pinned search_path on this function with a separate ALTER. A
-- CREATE OR REPLACE drops that, so it is restored inline here — this is
-- exactly the kind of thing that silently un-hardens a function.
create or replace function get_join_session(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_session sessions%rowtype;
begin
  -- Before the lookup, so a miss costs the attacker a slot too. Limiting only
  -- successful guesses would leave enumeration free.
  perform rate_limit_hit('join_code', 12, interval '10 minutes');

  select * into v_session from sessions
    where join_code = p_code and status in ('draft','live');
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_session.id,
    'name', v_session.name,
    'format', v_session.format,
    'status', v_session.status,
    'public_token', v_session.public_token
  );
end;
$$;

grant execute on function get_join_session(text) to anon, authenticated;

comment on function rate_limit_hit(text, int, interval) is
  'Per-IP rate limit for a named scope, backed by auth_probe_log. Raises P0001 when exceeded. Supabase does not rate-limit /rest/v1/ on any plan, so every RPC that takes a guessable secret should call this.';
