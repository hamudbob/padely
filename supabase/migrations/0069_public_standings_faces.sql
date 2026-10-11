-- ---------------------------------------------------------------------
-- 0069_public_standings_faces.sql
--
-- Faces on the public live board, and "no account" for spots nobody has
-- claimed — the same thing the host's Standings tab now shows.
--
-- get_public_session (the spectator link, by token) emitted players as
-- id / name / status / side only. It now also emits:
--   avatar_url  the player's profile picture, if their spot is linked
--   linked      whether the spot belongs to an account at all
-- and get_public_session_by_id (the podium page, 0039), which re-emits the
-- players list, gains `linked` too.
--
-- Deliberately NOT the account id: anyone holding the link can read this,
-- and "this spot has an account" is all the board needs to know.
-- avatar_url was already public on the podium page (0039) for the same
-- people, so exposing it here widens nothing.
--
-- Both bodies are copied verbatim from 0011 and 0039; only the players
-- block changes. Grants are unchanged (create or replace keeps them).
-- `set search_path = public` is restated on purpose: 0021 added it with
-- ALTER FUNCTION, and a CREATE OR REPLACE without it would drop it again.
-- ---------------------------------------------------------------------

create or replace function get_public_session(p_public_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_session sessions%rowtype;
  v_result jsonb;
begin
  select * into v_session from sessions where public_token = p_public_token;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'name', v_session.name,
      'format', v_session.format,
      'scoring_format', v_session.scoring_format,
      'ranking_basis', v_session.ranking_basis,
      'fixed_partner_style', v_session.fixed_partner_style,
      'status', v_session.status
    ),
    'courts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'available', available)), '[]'::jsonb)
               from courts where session_id = v_session.id),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'display_name', p.display_name, 'status', p.status, 'team_side', p.team_side,
                  -- 0069: a face for the standings, and whether the spot belongs
                  -- to an account at all. Never the account id itself.
                  'avatar_url', pr.avatar_url,
                  'linked', p.linked_user_id is not null)), '[]'::jsonb)
                from players p
                left join profiles pr on pr.id = p.linked_user_id
               where p.session_id = v_session.id),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'sequence', sequence, 'status', status) order by sequence), '[]'::jsonb)
               from rounds where session_id = v_session.id),
    'adjustments', (select coalesce(jsonb_agg(jsonb_build_object(
                      'player_id', player_id, 'pair_id', pair_id, 'amount', amount)), '[]'::jsonb)
                    from adjustments where session_id = v_session.id),
    'pairs', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'player_a_id', player_a_id, 'player_b_id', player_b_id)), '[]'::jsonb)
              from pairs where session_id = v_session.id),
    'matches', (
      select coalesce(jsonb_agg(
               jsonb_build_object(
                 'id', m.id,
                 'round_sequence', r.sequence,
                 'court_name', c.display_name,
                 'status', m.status,
                 'outcome', m.outcome,
                 'score_a', m.score_a,
                 'score_b', m.score_b,
                 'team_a', (select jsonb_agg(p.display_name)
                            from match_participants mp join players p on p.id = mp.player_id
                            where mp.match_id = m.id and mp.side = 'A'),
                 'team_b', (select jsonb_agg(p.display_name)
                            from match_participants mp join players p on p.id = mp.player_id
                            where mp.match_id = m.id and mp.side = 'B'),
                 'participants', (select coalesce(jsonb_agg(jsonb_build_object('player_id', mp.player_id, 'side', mp.side)), '[]'::jsonb)
                                  from match_participants mp where mp.match_id = m.id)
               )
               order by r.sequence, c.ordinal
             ), '[]'::jsonb)
      from matches m
      join courts c on c.id = m.court_id
      join rounds r on r.id = m.round_id
      where r.session_id = v_session.id
    )
  ) into v_result;
  return v_result;
end;
$$;

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
               'avatar_url', pr.avatar_url,
               'linked', p.linked_user_id is not null
             )), '[]'::jsonb)
      from players p
      left join profiles pr on pr.id = p.linked_user_id
      where p.session_id = v_session.id
    )
  );
end;
$$;
