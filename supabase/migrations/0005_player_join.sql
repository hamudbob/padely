-- ---------------------------------------------------------------------
-- 0005_player_join.sql
-- Self-service player join by QR / 6-digit code, with HOST CONFIRMATION and
-- email-keyed guest persistence.
--
-- Model: anyone with the code can submit a join REQUEST (name, gender,
-- left/right side, optional email) via a SECURITY DEFINER RPC — never a direct
-- table grant. The host reviews pending requests and confirms them; confirming
-- is what actually inserts the player into the roster. A guest's details are
-- keyed by email so a returning guest is pre-filled, and the row is ready to
-- link to a real account (players.linked_user_id) if they ever sign up with
-- that same email.
-- ---------------------------------------------------------------------

-- --- Player capture fields -------------------------------------------
-- email so a confirmed guest can later be matched to an account created with
-- the same address; preferred_side is the padel left/right court preference
-- (distinct from team_side's Team Sparring A/B), captured for pairing.
alter table players add column if not exists email text;
alter table players add column if not exists preferred_side char(1) check (preferred_side in ('L','R'));
create index if not exists players_email_idx on players (lower(email));

-- --- Join requests ---------------------------------------------------
create table if not exists join_requests (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  gender        char(1) not null default 'M' check (gender in ('M','F')),
  team_side     char(1) check (team_side in ('A','B')),        -- Team Sparring only
  preferred_side char(1) check (preferred_side in ('L','R')),  -- padel left/right preference
  email         text,
  status        text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  player_id     uuid references players(id) on delete set null, -- set when confirmed
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists join_requests_session_idx on join_requests (session_id, status);

alter table join_requests enable row level security;

-- The host manages requests for their own sessions. There is deliberately NO
-- anon/public policy: the public only ever writes here through request_join().
drop policy if exists host_all_join_requests on join_requests;
create policy host_all_join_requests on join_requests for all
  using (is_session_host(session_id)) with check (is_session_host(session_id));

-- --- Public RPCs (SECURITY DEFINER, granted to anon) ------------------

-- Validate a code and return the minimal session info the join form needs
-- (name + format so it knows whether to ask for gender/side). Null if the code
-- doesn't match a joinable session.
create or replace function get_join_session(p_code text)
returns jsonb language plpgsql stable security definer as $$
declare
  v_session sessions%rowtype;
begin
  select * into v_session from sessions
    where join_code = p_code and status in ('draft','live');
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_session.id,
    'name', v_session.name,
    'format', v_session.format,
    'status', v_session.status
  );
end;
$$;

-- Submit a join request. Inserts a PENDING row the host must confirm — it does
-- not add the player. Returns the request id + session name so the joiner sees
-- "waiting for the host". Rejects codes for missing/ended sessions.
create or replace function request_join(
  p_code text,
  p_name text,
  p_gender text default 'M',
  p_team_side text default null,
  p_preferred_side text default null,
  p_email text default null
)
returns jsonb language plpgsql volatile security definer as $$
declare
  v_session sessions%rowtype;
  v_request_id uuid;
begin
  select * into v_session from sessions
    where join_code = p_code and status in ('draft','live');
  if not found then
    raise exception 'That code doesn''t match an open session.' using errcode = 'P0002';
  end if;
  if char_length(coalesce(trim(p_name), '')) = 0 then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;

  insert into join_requests (session_id, display_name, gender, team_side, preferred_side, email)
    values (
      v_session.id,
      trim(p_name),
      case when p_gender in ('M','F') then p_gender else 'M' end,
      case when p_team_side in ('A','B') then p_team_side else null end,
      case when p_preferred_side in ('L','R') then p_preferred_side else null end,
      nullif(trim(coalesce(p_email, '')), '')
    )
    returning id into v_request_id;

  return jsonb_build_object(
    'requestId', v_request_id,
    'sessionId', v_session.id,
    'sessionName', v_session.name,
    'sessionStatus', v_session.status
  );
end;
$$;

-- Pre-fill a returning guest from the most recent details tied to their email
-- (across any session). Null if we've never seen this email.
create or replace function lookup_guest(p_email text)
returns jsonb language plpgsql stable security definer as $$
declare
  v jsonb;
begin
  if char_length(coalesce(trim(p_email), '')) = 0 then
    return null;
  end if;
  select jsonb_build_object('name', display_name, 'gender', gender, 'preferredSide', preferred_side)
    into v
    from join_requests
    where lower(email) = lower(trim(p_email))
    order by created_at desc
    limit 1;
  return v;
end;
$$;

grant execute on function get_join_session(text) to anon, authenticated;
grant execute on function request_join(text, text, text, text, text, text) to anon, authenticated;
grant execute on function lookup_guest(text) to anon, authenticated;
