-- ---------------------------------------------------------------------
-- 0040_unrate_on_delete.sql
--
-- Deleting a session used to leave its rating behind.
--
-- profiles.rating is a SNAPSHOT that apply_session_ratings overwrites at the
-- end of every session. Deleting the session cascades away the matches, the
-- players and the league rows — so the record recomputes and the league board
-- forgets it — but nothing ever walked the rating back. Run a test session,
-- win it, delete it: the spike stays, permanently, and the rating no longer
-- corresponds to any game that exists. rating_history kept a point for it too,
-- with session_id nulled by the FK, so the trend line kept a bump nobody could
-- trace to a session.
--
-- THE APPROACH: record enough at rating time to undo it at delete time.
--
-- rating_history gains the pre-session snapshot (rating / RD / volatility /
-- games as they were before that session was applied) plus games_after, so the
-- session's own game count is derivable. Then deleting a session reverses it:
--
--   • if that session is the player's MOST RECENT rated session, restore the
--     snapshot exactly — a perfect undo, including RD and volatility
--   • if later sessions have been rated since, subtract that session's delta
--     and its game count, and leave RD/volatility alone
--
-- Why the split: Glicko-2 is sequential, not additive. A player's RD and
-- volatility after session N depend on the whole ordered chain before it, so
-- there is no arithmetic that "removes" a session from the middle — the only
-- exact answer is a full replay from 1500/350/0.06 over every remaining
-- session, for every player whose chain is affected, which is a rebuild job and
-- not something a delete button should trigger. Subtracting the delta keeps the
-- points honest (the number is the sum of what still exists) and is exact for
-- the case this actually gets used for: throwing away a test session you just
-- ran. The comment on the function says so, so nobody mistakes it for algebra.
--
-- Deleting is now an RPC rather than a client-side table delete, so the unrate
-- and the delete are one transaction: a failure can't leave points credited to
-- a session that no longer exists.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

alter table rating_history add column if not exists rating_before numeric;
alter table rating_history add column if not exists rd_before     numeric;
alter table rating_history add column if not exists vol_before    numeric;
alter table rating_history add column if not exists games_before  integer;
alter table rating_history add column if not exists games_after   integer;

comment on column rating_history.rating_before is
  'Rating as it stood before this session was applied — lets 0040 undo the session exactly when it is the player''s most recent.';

-- --- apply_session_ratings: capture the snapshot as it writes -----------
-- Reproduced from 0021 in full (create or replace replaces the whole body) with
-- one addition: read the profile's current values before overwriting them, and
-- store them on the history row.
create or replace function apply_session_ratings(p_session_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_applied boolean;
  u jsonb;
  v_before  profiles%rowtype;
begin
  select status, coalesce(ratings_applied, false) into v_status, v_applied
    from sessions where id = p_session_id;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not is_session_host(p_session_id) then
    raise exception 'Only the host can apply ratings for this session.' using errcode = 'P0001';
  end if;
  if v_status <> 'ended' then
    raise exception 'Ratings apply only once a session has ended.' using errcode = 'P0001';
  end if;
  if v_applied then return; end if;

  for u in select value from jsonb_array_elements(p_updates) as value loop
    -- Only accounts that actually played THIS session may be rated — closes the
    -- "throwaway session overwrites a stranger's global rating" hole.
    if not exists (
      select 1 from players
      where session_id = p_session_id and linked_user_id = (u->>'user_id')::uuid
    ) then
      continue;
    end if;

    -- Where this player stood BEFORE this session. Read first, then overwrite.
    select * into v_before from profiles where id = (u->>'user_id')::uuid;

    update profiles set
      rating            = (u->>'rating')::numeric,
      rating_deviation  = (u->>'rd')::numeric,
      rating_volatility = (u->>'vol')::numeric,
      rating_games      = (u->>'games')::int,
      updated_at        = now()
    where id = (u->>'user_id')::uuid;

    insert into rating_history (
      user_id, session_id, rating, delta,
      rating_before, rd_before, vol_before, games_before, games_after
    ) values (
      (u->>'user_id')::uuid, p_session_id, (u->>'rating')::numeric, (u->>'delta')::numeric,
      v_before.rating, v_before.rating_deviation, v_before.rating_volatility,
      v_before.rating_games, (u->>'games')::int
    );
  end loop;

  update sessions set ratings_applied = true where id = p_session_id;
end;
$$;

-- --- delete a session and take its rating with it -----------------------
create or replace function delete_session_and_unrate(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_deleted integer;
  h         record;
  v_is_last boolean;
  v_later   numeric;
  v_later_games integer;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  -- Same gate the old client-side delete relied on: only the host, enforced by
  -- host_all_sessions RLS. Stated explicitly here because SECURITY DEFINER
  -- bypasses that policy.
  if not is_session_host(p_session_id) then
    raise exception 'Only the host can delete this session.' using errcode = 'P0001';
  end if;

  -- Walk every player this session rated and undo it.
  for h in
    select * from rating_history where session_id = p_session_id
  loop
    -- Is this the player's most recent rated session? If so we can put them
    -- back exactly as they were.
    select not exists (
      select 1 from rating_history r2
      where r2.user_id = h.user_id
        and r2.session_id is distinct from h.session_id
        and (r2.created_at > h.created_at
             or (r2.created_at = h.created_at and r2.id > h.id))
    ) into v_is_last;

    if v_is_last and h.rating_before is not null then
      update profiles set
        rating            = h.rating_before,
        rating_deviation  = coalesce(h.rd_before, rating_deviation),
        rating_volatility = coalesce(h.vol_before, rating_volatility),
        rating_games      = coalesce(h.games_before, rating_games),
        updated_at        = now()
      where id = h.user_id;
    else
      -- Sessions have been rated since (or this row predates 0040 and has no
      -- snapshot): subtract this session's contribution instead. Points stay
      -- the sum of what still exists; RD and volatility are left as the later
      -- sessions set them, because they aren't reversible term by term.
      v_later := coalesce(h.delta, 0);
      v_later_games := coalesce(h.games_after - h.games_before, 0);
      update profiles set
        rating       = greatest(100, rating - v_later),
        rating_games = greatest(0, rating_games - v_later_games),
        updated_at   = now()
      where id = h.user_id;
    end if;
  end loop;

  -- The trend line should forget it too. Without this the FK would merely null
  -- session_id and leave an untraceable bump on the sparkline.
  delete from rating_history where session_id = p_session_id;

  -- session_results (league + Champions Hall) cascade with the session itself.
  delete from sessions where id = p_session_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function delete_session_and_unrate(uuid) from anon;
grant execute on function delete_session_and_unrate(uuid) to authenticated;

comment on function delete_session_and_unrate(uuid) is
  'Deletes a session and reverses the rating it applied. Exact for the player''s most recent session (restores the stored snapshot); for older ones it subtracts that session''s delta and game count — Glicko-2 is sequential, so removing a middle session exactly would require a full replay.';
