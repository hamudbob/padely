-- ---------------------------------------------------------------------
-- 0047 — credit one player's rating for a session that already ended.
--
-- THE PROBLEM. Someone plays a whole session under a name the host typed in,
-- and only afterwards realises they never claimed the spot. The session has
-- ended, its ratings are applied, and claiming is over. Their games are on the
-- board under a name that belongs to nobody.
--
-- THE OBVIOUS FIX IS WRONG. Reopening the session so they can claim, then
-- ending it again, does nothing: apply_session_ratings is guarded by
-- sessions.ratings_applied precisely so a session can't count twice. Clearing
-- that guard is worse — it re-applies every OTHER player's delta a second
-- time. And Glicko is sequential: once those players have played later
-- sessions you cannot undo one in the middle and redo it without invalidating
-- everything after it.
--
-- WHAT THIS DOES INSTEAD. An admin links the player row to the account
-- (admin_link_player, 0041), then credits that ONE account for that ONE
-- session. Nobody else's number is touched, no session ever returns to live,
-- and the guard stays on.
--
-- Two honest limitations, both recorded in admin_actions with the change:
--
--   * The delta is applied to the account's rating AS IT IS NOW, not inserted
--     back into the middle of its history. If they've played since, the result
--     counts from today rather than from the night it happened. Rewriting the
--     chain would mean recomputing every session after it for every player in
--     them, which is a different and much larger operation.
--   * Their opponents' ratings were computed against a default 1500 stand-in
--     for the unlinked player, and that is not revisited. It is exactly what
--     would have happened had this person signed up on the night as a new
--     account, so it is a consistent outcome rather than a distorted one.
--
-- Idempotent by construction: a rating_history row for (user, session) means
-- this session has already counted for them, and the function refuses.
-- ---------------------------------------------------------------------

create or replace function admin_credit_session_rating(
  p_session_id uuid,
  p_user_id    uuid,
  p_rating     numeric,
  p_rd         numeric,
  p_vol        numeric,
  p_games      int,
  p_delta      numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_before  profiles%rowtype;
  v_player  players%rowtype;
begin
  perform admin_guard();

  select status into v_status from sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'ended' then
    raise exception 'That session has not ended yet — let the host end it, which rates everyone normally.'
      using errcode = 'P0001';
  end if;

  -- They must actually hold a seat in this session. Link it first.
  select * into v_player from players
   where session_id = p_session_id and linked_user_id = p_user_id
   limit 1;
  if not found then
    raise exception 'That account does not hold a spot in this session. Link the player row first.'
      using errcode = 'P0001';
  end if;

  -- Already counted — refuse rather than double-count.
  if exists (select 1 from rating_history where user_id = p_user_id and session_id = p_session_id) then
    raise exception 'This session has already counted toward that account''s rating.'
      using errcode = 'P0001';
  end if;

  select * into v_before from profiles where id = p_user_id;
  if not found then
    raise exception 'No such account.' using errcode = 'P0002';
  end if;

  update profiles set
    rating            = p_rating,
    rating_deviation  = p_rd,
    rating_volatility = p_vol,
    rating_games      = p_games,
    updated_at        = now()
  where id = p_user_id;

  insert into rating_history (
    user_id, session_id, rating, delta,
    rating_before, rd_before, vol_before, games_before, games_after
  ) values (
    p_user_id, p_session_id, p_rating, p_delta,
    v_before.rating, v_before.rating_deviation, v_before.rating_volatility,
    v_before.rating_games, p_games
  );

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (
    auth.uid(), 'credit_session_rating', 'user', p_user_id,
    jsonb_build_object(
      'session_id', p_session_id,
      'player_id', v_player.id,
      'player_name', v_player.display_name,
      'rating_before', v_before.rating,
      'rating_after', p_rating,
      'delta', p_delta,
      'games_before', v_before.rating_games,
      'games_after', p_games,
      'note', 'Applied to the current rating, not back-dated into history.'
    )
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'session_id', p_session_id,
    'rating_before', v_before.rating,
    'rating_after', p_rating,
    'delta', p_delta
  );
end;
$$;

revoke all on function admin_credit_session_rating(uuid, uuid, numeric, numeric, numeric, int, numeric) from anon;
grant execute on function admin_credit_session_rating(uuid, uuid, numeric, numeric, numeric, int, numeric) to authenticated;

comment on function admin_credit_session_rating(uuid, uuid, numeric, numeric, numeric, int, numeric) is
  'Admin repair for a spot claimed after the session ended: credits one account for one ended session, once. Refuses if a rating_history row already exists for that pair. The delta is applied to the account''s current rating rather than back-dated, and the other players'' ratings are not revisited.';
