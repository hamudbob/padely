-- ---------------------------------------------------------------------
-- 0010_public_session_id.sql
-- Two spectator-view improvements, both inside get_public_session:
--   1. Re-asserts the 0008 body (every round's per-court matches), so a project
--      that never applied 0008 gets the rounds/scores in one step here.
--   2. Adds the session's `id` to the returned `session` object, so the
--      spectator client can subscribe to a Realtime *broadcast* channel keyed by
--      that id (live push without exposing any table to anon — the data itself
--      still comes only through this security-definer function).
-- Read-only + security definer. Safe/idempotent to re-run.
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
      'id', v_session.id,
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
