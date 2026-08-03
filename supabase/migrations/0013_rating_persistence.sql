-- ---------------------------------------------------------------------
-- 0013_rating_persistence.sql  (Phase 1, increment 3)
--
-- Persists the global Glicko-2 rating at session end. The host's client
-- computes each participant's new rating from the session's matches (using the
-- same engine in src/lib/rating), then submits them through the SECURITY
-- DEFINER apply_session_ratings() RPC — which is the ONLY thing allowed to write
-- another player's rating, and which:
--   * requires the caller to own the (ended) session,
--   * is IDEMPOTENT via sessions.ratings_applied (a session can't double-count),
--   * writes the new rating onto each profile AND appends a rating_history row
--     (for the profile trend / sparkline).
--
-- Trust model: identical to score entry — the host already controls the scores
-- the rating is derived from, so trusting their client to compute the update
-- adds no new surface. Can move to an Edge Function later for full integrity.
-- ---------------------------------------------------------------------

alter table sessions add column if not exists ratings_applied boolean not null default false;

create table if not exists rating_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  rating     numeric not null,
  delta      numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists rating_history_user_idx on rating_history (user_id, created_at);

alter table rating_history enable row level security;
-- Readable by any signed-in user (non-sensitive: a number over time). There is
-- deliberately NO insert/update/delete policy — rows are written ONLY by the
-- SECURITY DEFINER function below, never straight from a client.
drop policy if exists rating_history_read on rating_history;
create policy rating_history_read on rating_history for select to authenticated using (true);

create or replace function apply_session_ratings(p_session_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_applied boolean;
  u jsonb;
begin
  select status, coalesce(ratings_applied, false)
    into v_status, v_applied
    from sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if not is_session_host(p_session_id) then
    raise exception 'Only the host can apply ratings for this session.' using errcode = 'P0001';
  end if;
  if v_status <> 'ended' then
    raise exception 'Ratings apply only once a session has ended.' using errcode = 'P0001';
  end if;
  if v_applied then
    return; -- idempotent: already applied, no double-counting
  end if;

  for u in select value from jsonb_array_elements(p_updates) as value loop
    update profiles set
      rating            = (u->>'rating')::numeric,
      rating_deviation  = (u->>'rd')::numeric,
      rating_volatility = (u->>'vol')::numeric,
      rating_games      = (u->>'games')::int,
      updated_at        = now()
    where id = (u->>'user_id')::uuid;

    insert into rating_history (user_id, session_id, rating, delta)
      values ((u->>'user_id')::uuid, p_session_id, (u->>'rating')::numeric, (u->>'delta')::numeric);
  end loop;

  update sessions set ratings_applied = true where id = p_session_id;
end;
$$;

grant execute on function apply_session_ratings(uuid, jsonb) to authenticated;
