-- ---------------------------------------------------------------------
-- 0008_public_court_scores.sql
-- Adds per-court scores to the spectator view. get_public_session now also
-- returns every round's matches (court name, both teams' names, and the score),
-- each tagged with its round_sequence so /live can page through rounds one at a
-- time instead of showing one long list. Read-only + security definer.
-- ---------------------------------------------------------------------
create or replace function get_public_session(p_public_token text)
returns jsonb language plpgsql stable security definer as $$
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
      'name', v_session.name, 'format', v_session.format,
      'scoring_format', v_session.scoring_format, 'status', v_session.status
    ),
    'courts', (select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'available', available))
               from courts where session_id = v_session.id),
    'players', (select jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'status', status))
                from players where session_id = v_session.id),
    'standings', (select jsonb_agg(to_jsonb(s)) from standings_live s where s.session_id = v_session.id),
    'rounds', (select jsonb_agg(jsonb_build_object('id', id, 'sequence', sequence, 'status', status) order by sequence)
               from rounds where session_id = v_session.id),
    'matches', (
      select jsonb_agg(
               jsonb_build_object(
                 'round_sequence', r.sequence,
                 'court_name', c.display_name,
                 'score_a', m.score_a,
                 'score_b', m.score_b,
                 'status', m.status,
                 'team_a', (select jsonb_agg(p.display_name)
                            from match_participants mp join players p on p.id = mp.player_id
                            where mp.match_id = m.id and mp.side = 'A'),
                 'team_b', (select jsonb_agg(p.display_name)
                            from match_participants mp join players p on p.id = mp.player_id
                            where mp.match_id = m.id and mp.side = 'B')
               )
               order by r.sequence, c.ordinal
             )
      from matches m
      join courts c on c.id = m.court_id
      join rounds r on r.id = m.round_id
      where r.session_id = v_session.id
    )
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function get_public_session(text) to anon, authenticated;
