-- ---------------------------------------------------------------------
-- 0029_player_claims.sql  (late-joiner "claim your spot")
--
-- A session can start with manual placeholder names and rounds running before
-- anyone signs in. Later, a signed-in player opens the live view, claims the
-- name that represents them, and the host accepts — from then on that player
-- row is owned by their account, so every point/game already recorded under it
-- becomes their data (and counts toward their global rating at session end).
--
-- Mechanics: a claim links an account to an EXISTING players row by setting
-- players.linked_user_id. Because matches reference the player row (not the
-- account), nothing has to be migrated. All state changes go through the
-- SECURITY DEFINER RPCs below — a client can never set linked_user_id directly.
--
-- Only signed-in users can claim (there'd be no persistent identity to attach
-- to otherwise); everyone else simply watches the live view.
-- ---------------------------------------------------------------------

create table if not exists player_claims (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references sessions(id) on delete cascade,
  player_id         uuid not null references players(id) on delete cascade,
  claimant_user_id  uuid not null references profiles(id) on delete cascade,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);
create index if not exists player_claims_session_idx on player_claims (session_id, status);
create index if not exists player_claims_player_idx on player_claims (player_id);

alter table player_claims enable row level security;
-- No direct client policies: every read/write goes through the RPCs below.

-- The still-claimable names for a session, addressed by its public token (the
-- same token the live view uses). Signed-in only — claiming needs an account.
create or replace function get_claimable_players(p_public_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_session sessions%rowtype;
begin
  select * into v_session from sessions where public_token = p_public_token;
  if not found then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.display_name)
      from players p
     where p.session_id = v_session.id
       and p.linked_user_id is null
       and p.status = 'active'
  ), '[]'::jsonb);
end;
$$;
grant execute on function get_claimable_players(text) to authenticated;

-- A signed-in player requests to claim an unclaimed, active spot. One pending
-- claim per person per session (a new request replaces the previous one).
create or replace function request_player_claim(p_player_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_player players%rowtype; v_uid uuid := auth.uid(); v_status text; v_claim_id uuid;
begin
  if v_uid is null then raise exception 'Sign in to claim a spot.' using errcode = 'P0001'; end if;
  select * into v_player from players where id = p_player_id;
  if not found then raise exception 'That spot no longer exists.' using errcode = 'P0002'; end if;
  if v_player.linked_user_id is not null then raise exception 'That spot is already taken.' using errcode = 'P0001'; end if;
  if v_player.status <> 'active' then raise exception 'That spot is not active.' using errcode = 'P0001'; end if;
  select status into v_status from sessions where id = v_player.session_id;
  if v_status = 'ended' then raise exception 'This session has ended.' using errcode = 'P0001'; end if;
  if exists (select 1 from players where session_id = v_player.session_id and linked_user_id = v_uid) then
    raise exception 'You already hold a spot in this session.' using errcode = 'P0001';
  end if;

  delete from player_claims
    where session_id = v_player.session_id and claimant_user_id = v_uid and status = 'pending';
  insert into player_claims (session_id, player_id, claimant_user_id)
    values (v_player.session_id, p_player_id, v_uid)
    returning id into v_claim_id;
  return jsonb_build_object('claim_id', v_claim_id);
end;
$$;
grant execute on function request_player_claim(uuid) to authenticated;

-- The caller's own claim status for a session (for the live-view feedback).
create or replace function get_my_session_claim(p_public_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_session sessions%rowtype; v_uid uuid := auth.uid(); v_claim player_claims%rowtype;
begin
  if v_uid is null then return null; end if;
  select * into v_session from sessions where public_token = p_public_token;
  if not found then return null; end if;
  -- Already linked to a spot → they're in.
  if exists (select 1 from players where session_id = v_session.id and linked_user_id = v_uid) then
    return jsonb_build_object(
      'status', 'joined',
      'player_name', (select display_name from players where session_id = v_session.id and linked_user_id = v_uid limit 1)
    );
  end if;
  select * into v_claim from player_claims
    where session_id = v_session.id and claimant_user_id = v_uid
    order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'status', v_claim.status,
    'player_name', (select display_name from players where id = v_claim.player_id)
  );
end;
$$;
grant execute on function get_my_session_claim(text) to authenticated;

-- Host: the pending claims for a session, with each claimant's profile.
create or replace function get_pending_claims(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_session_host(p_session_id) then
    raise exception 'Only the host can view claims.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id,
             'player_id', c.player_id,
             'player_name', p.display_name,
             'claimant_id', c.claimant_user_id,
             'claimant_name', pr.display_name,
             'claimant_avatar', pr.avatar_url
           ) order by c.created_at)
      from player_claims c
      join players p on p.id = c.player_id
      join profiles pr on pr.id = c.claimant_user_id
     where c.session_id = p_session_id and c.status = 'pending'
  ), '[]'::jsonb);
end;
$$;
grant execute on function get_pending_claims(uuid) to authenticated;

-- Host: accept or reject a claim. Accepting links the account to the player row
-- AND renames the spot to the claimant's real name (so everyone sees the account
-- has joined and exactly who it is), then auto-rejects competing claims.
create or replace function respond_player_claim(p_claim_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_claim player_claims%rowtype; v_name text;
begin
  select * into v_claim from player_claims where id = p_claim_id;
  if not found then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if not is_session_host(v_claim.session_id) then
    raise exception 'Only the host can respond to claims.' using errcode = 'P0001';
  end if;
  if v_claim.status <> 'pending' then return; end if; -- idempotent

  if p_accept then
    if exists (select 1 from players where id = v_claim.player_id and linked_user_id is not null) then
      raise exception 'That spot was already taken.' using errcode = 'P0001';
    end if;
    if exists (select 1 from players where session_id = v_claim.session_id and linked_user_id = v_claim.claimant_user_id) then
      raise exception 'That player already holds a spot here.' using errcode = 'P0001';
    end if;
    select display_name into v_name from profiles where id = v_claim.claimant_user_id;
    update players
       set linked_user_id = v_claim.claimant_user_id,
           display_name   = coalesce(nullif(trim(v_name), ''), display_name)
     where id = v_claim.player_id;
    update player_claims set status = 'approved', decided_at = now() where id = p_claim_id;
    update player_claims set status = 'rejected', decided_at = now()
      where player_id = v_claim.player_id and status = 'pending' and id <> p_claim_id;
  else
    update player_claims set status = 'rejected', decided_at = now() where id = p_claim_id;
  end if;
end;
$$;
grant execute on function respond_player_claim(uuid, boolean) to authenticated;
