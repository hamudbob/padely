-- ---------------------------------------------------------------------
-- 0039_participant_reads.sql
--
-- THE BUG BEHIND ALL OF THIS: every table that describes what happened in a
-- session — players, matches, match_participants, rounds, courts — carries
-- exactly one policy, `host_all_*`, scoped to `is_session_host()`. Anyone who
-- merely PLAYED in a session reads nothing from them. And RLS denies by
-- returning an empty result rather than an error, so the app didn't fail, it
-- just quietly rendered zeros:
--
--   • the You tab's record said "play a session and your record shows up here"
--     while the rating strip above it read 1324 / 7 games (profiles is
--     world-readable, and the host's apply_session_ratings had written it)
--   • Played / Games counted 0 with a finished session sitting in the list
--   • an ended session opened from a player's account rendered a podium with
--     one name in it and no standings
--
-- Two SECURITY DEFINER doors, both returning only what the caller is already
-- entitled to see:
--
-- 1. get_public_session_by_id — the by-id twin of get_public_session. Same
--    payload, same access model; it exists because the final/podium screen is
--    routed by session id (/session/:id/final) while the spectator view is
--    routed by token. It delegates rather than duplicating: one definition of
--    what a spectator may read, forever.
--
--    It adds four keys the podium needs and the token version doesn't carry:
--    public_token (so the page can link on to standings & rounds), club_name
--    and session_date (for the shareable recap card), and avatar_url on each
--    player (already public on their profile — linked_user_id is deliberately
--    NOT exposed, so this reveals no account linkage).
--
-- 2. get_my_participation — the raw rows behind the caller's own record:
--    their player rows, the matches they were in, everyone who was in those
--    matches, and enough chronology to order them. The client computes the
--    record from these with the same code it always used, so there is still
--    exactly one implementation of the maths.
--
-- Idempotent and safe to re-run.
-- ---------------------------------------------------------------------

-- --- 1. The podium, by session id, for participants and share links ----
create or replace function get_public_session_by_id(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session sessions%rowtype;
  v_payload jsonb;
begin
  select * into v_session from sessions where id = p_session_id;
  if not found then
    return null;
  end if;

  -- A draft is a lobby the host hasn't started: nothing to show, and its
  -- roster is the host's business until it does.
  if v_session.status = 'draft' then
    return null;
  end if;

  -- Delegate, so spectator visibility has one definition.
  v_payload := get_public_session(v_session.public_token);
  if v_payload is null then
    return null;
  end if;

  return v_payload || jsonb_build_object(
    'public_token', v_session.public_token,
    'session_date', coalesce(v_session.ended_at, v_session.started_at, v_session.created_at),
    'club_name', (select c.name from clubs c where c.id = v_session.club_id),
    -- Re-emit players with their avatar, for the recap card's podium faces.
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id,
               'display_name', p.display_name,
               'status', p.status,
               'team_side', p.team_side,
               'avatar_url', pr.avatar_url
             )), '[]'::jsonb)
      from players p
      left join profiles pr on pr.id = p.linked_user_id
      where p.session_id = v_session.id
    )
  );
end;
$$;

revoke all on function get_public_session_by_id(uuid) from public;
grant execute on function get_public_session_by_id(uuid) to anon, authenticated;

-- --- 2. The caller's own participation, for their record ---------------
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
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'round_id', m.round_id, 'outcome', m.outcome, 'status', m.status)), '[]'::jsonb)
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
    'sessions', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'created_at', s.created_at)), '[]'::jsonb)
      from sessions s
      where s.id in (select p.session_id from players p where p.id = any(v_my_player_ids))
    ),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'display_name', p.display_name, 'linked_user_id', p.linked_user_id)), '[]'::jsonb)
      from players p
      where p.id in (select mp.player_id from match_participants mp where mp.match_id = any(v_match_ids))
    )
  );
end;
$$;

revoke all on function get_my_participation() from anon;
grant execute on function get_my_participation() to authenticated;

comment on function get_public_session_by_id(uuid) is
  'Spectator payload for a session addressed by id (the /session/:id/final route). Delegates to get_public_session so visibility has one definition.';
comment on function get_my_participation() is
  'The caller''s own player rows, matches and co-players — the raw rows the You tab computes a record from. Players cannot read those tables directly (host-only RLS).';
