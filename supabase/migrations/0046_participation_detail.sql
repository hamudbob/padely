-- ---------------------------------------------------------------------
-- 0046 — more of the caller's own history, for the record detail.
--
-- get_my_participation (0039) already returns every final match the caller
-- played, both sides, in chronological order. The profile now wants four
-- things it can't derive from that payload:
--
--   * points scored and conceded  -> matches.score_a / score_b
--   * "last 30 days" vs all time  -> sessions.ended_at, so the split is by
--                                    when the session actually finished
--                                    rather than when it was created
--   * record by format (later)    -> sessions.format
--   * a face beside a partner     -> the person's avatar_url
--
-- The function returns jsonb, so adding keys is additive: an older client
-- reading the old keys is unaffected, which is what makes this safe to run
-- before the matching deploy as well as after.
--
-- Nothing new is exposed. Scores and formats belong to sessions the caller
-- played in, and avatar_url is already on their public profile. Idempotent.
-- ---------------------------------------------------------------------

create or replace function get_my_participation()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_my_player_ids uuid[];
  v_match_ids uuid[];
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}') into v_my_player_ids
    from players where linked_user_id = v_uid;

  if array_length(v_my_player_ids, 1) is null then
    return jsonb_build_object(
      'my_players', '[]'::jsonb, 'my_participations', '[]'::jsonb,
      'matches', '[]'::jsonb, 'participants', '[]'::jsonb,
      'rounds', '[]'::jsonb, 'sessions', '[]'::jsonb, 'people', '[]'::jsonb
    );
  end if;

  select coalesce(array_agg(distinct mp.match_id), '{}') into v_match_ids
    from match_participants mp where mp.player_id = any(v_my_player_ids);

  return jsonb_build_object(
    'my_players', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'session_id', p.session_id)), '[]'::jsonb)
      from players p where p.id = any(v_my_player_ids)
    ),
    'my_participations', (
      select coalesce(jsonb_agg(jsonb_build_object('match_id', mp.match_id, 'player_id', mp.player_id, 'side', mp.side)), '[]'::jsonb)
      from match_participants mp where mp.player_id = any(v_my_player_ids)
    ),
    -- + score_a, score_b: the points the two sides actually scored, which is
    --   what "scored and conceded" is built from. Null for anything not final.
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'round_id', m.round_id, 'outcome', m.outcome, 'status', m.status,
               'score_a', m.score_a, 'score_b', m.score_b)), '[]'::jsonb)
      from matches m where m.id = any(v_match_ids)
    ),
    -- Everyone who was on court in those matches: needed to work out partners
    -- and opponents. Identity only — no email, no user id beyond the join key
    -- the client already uses to merge a person across sessions.
    'participants', (
      select coalesce(jsonb_agg(jsonb_build_object('match_id', mp.match_id, 'player_id', mp.player_id, 'side', mp.side)), '[]'::jsonb)
      from match_participants mp where mp.match_id = any(v_match_ids)
    ),
    'rounds', (
      select coalesce(jsonb_agg(distinct jsonb_build_object('id', r.id, 'session_id', r.session_id, 'sequence', r.sequence)), '[]'::jsonb)
      from rounds r
      where r.id in (select m.round_id from matches m where m.id = any(v_match_ids))
    ),
    -- + format and ended_at. ended_at is null while a session is still live,
    --   so the client falls back to created_at — a session that started in the
    --   window and hasn't finished still belongs in it.
    'sessions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'created_at', s.created_at,
               'ended_at', s.ended_at, 'format', s.format)), '[]'::jsonb)
      from sessions s
      where s.id in (select p.session_id from players p where p.id = any(v_my_player_ids))
    ),
    -- + avatar_url, so a partner can be shown as a face rather than a name.
    --   Left-joined: most players in a session have no account at all.
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'display_name', p.display_name,
               'linked_user_id', p.linked_user_id, 'avatar_url', pr.avatar_url)), '[]'::jsonb)
      from players p
      left join profiles pr on pr.id = p.linked_user_id
      where p.id in (select mp.player_id from match_participants mp where mp.match_id = any(v_match_ids))
    )
  );
end;
$$;

revoke all on function get_my_participation() from anon;
grant execute on function get_my_participation() to authenticated;

comment on function get_my_participation() is
  'The caller''s own participation rows: their players, the matches they were in with scores, everyone on court in those matches, and enough chronology and session detail (format, ended_at) for the profile to compute a record, streaks, a 30-day split and partner/rival stats client-side.';
