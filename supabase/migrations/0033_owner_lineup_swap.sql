-- ---------------------------------------------------------------------
-- 0033_owner_lineup_swap.sql  (owner-only lineup swap)
--
-- A private backdoor: lets ONE account (the app owner) swap two players within
-- a round — trade two on-court players, or pull a rester onto a court — so a
-- generated lineup can be hand-corrected. Deliberately NOT available to every
-- host: gated to a single email. Only allowed BEFORE any score is entered in
-- the session, so no finished result can ever change under a player's feet.
-- ---------------------------------------------------------------------

create or replace function swap_round_players(p_round_id uuid, p_player_a uuid, p_player_b uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
  v_email   text;
  v_a_match uuid; v_a_side char(1);
  v_b_match uuid; v_b_side char(1);
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is distinct from 'hamudbob@yahoo.com' then
    raise exception 'Not permitted.' using errcode = 'P0001';
  end if;

  select session_id into v_session from rounds where id = p_round_id;
  if v_session is null then raise exception 'Round not found.' using errcode = 'P0002'; end if;
  if not is_session_host(v_session) then
    raise exception 'Only the host can edit the lineup.' using errcode = 'P0001';
  end if;

  -- Locked once any match anywhere in the session has been scored.
  if exists (
    select 1 from matches m join rounds r on r.id = m.round_id
     where r.session_id = v_session and m.status = 'final'
  ) then
    raise exception 'Lineups are locked once scoring has started.' using errcode = 'P0001';
  end if;

  if p_player_a = p_player_b then return; end if;

  select mp.match_id, mp.side into v_a_match, v_a_side
    from match_participants mp join matches m on m.id = mp.match_id
   where m.round_id = p_round_id and mp.player_id = p_player_a;
  select mp.match_id, mp.side into v_b_match, v_b_side
    from match_participants mp join matches m on m.id = mp.match_id
   where m.round_id = p_round_id and mp.player_id = p_player_b;

  if v_a_match is not null and v_b_match is not null then
    -- Both on court: exchange their exact slots (match + side).
    delete from match_participants
      where (match_id = v_a_match and player_id = p_player_a)
         or (match_id = v_b_match and player_id = p_player_b);
    insert into match_participants (match_id, player_id, side) values
      (v_a_match, p_player_b, v_a_side),
      (v_b_match, p_player_a, v_b_side);
  elsif v_a_match is not null then
    -- A plays, B rests → B takes A's slot, A rests.
    delete from match_participants where match_id = v_a_match and player_id = p_player_a;
    insert into match_participants (match_id, player_id, side) values (v_a_match, p_player_b, v_a_side);
    delete from round_rests where round_id = p_round_id and player_id = p_player_b;
    insert into round_rests (round_id, player_id) values (p_round_id, p_player_a) on conflict do nothing;
  elsif v_b_match is not null then
    -- B plays, A rests → A takes B's slot, B rests.
    delete from match_participants where match_id = v_b_match and player_id = p_player_b;
    insert into match_participants (match_id, player_id, side) values (v_b_match, p_player_a, v_b_side);
    delete from round_rests where round_id = p_round_id and player_id = p_player_a;
    insert into round_rests (round_id, player_id) values (p_round_id, p_player_b) on conflict do nothing;
  else
    return; -- both resting: nothing to do
  end if;
end;
$$;

grant execute on function swap_round_players(uuid, uuid, uuid) to authenticated;
