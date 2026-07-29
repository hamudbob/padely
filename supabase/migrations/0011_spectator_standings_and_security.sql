-- ---------------------------------------------------------------------
-- 0011_spectator_standings_and_security.sql
--
-- TWO things, both preserving the intended anonymous spectate/join flow:
--
-- 1) LEADERBOARD PARITY. get_public_session now returns the RAW ingredients the
--    host's standings engine consumes (players + status + team_side, every final
--    match's outcome and participants, adjustments, pairs, and the session's
--    ranking_basis / scoring_format / fixed_partner_style). The spectator client
--    then runs the SAME assembleStandings()/computeStandings() the host uses, so
--    the two boards are computed by one function and can never diverge again
--    (fixes: missing rest compensation, ignored ranking_basis, fractional wins,
--    duplicated Fixed-Partner rows, dropped zero-match players). The old
--    standings_live-based 'standings' key is removed from the RPC.
--
-- 2) SECURITY, without breaking anon watching/joining:
--    a) Revoke direct anon/authenticated SELECT on the standings_live views —
--       spectators read through this SECURITY DEFINER RPC, never the tables, so
--       the views were an unnecessary cross-tenant back door.
--    b) lookup_guest is bound to the caller's own JWT email and revoked from
--       anon — it was an unauthenticated email->name/gender oracle. Signed-in
--       guest prefill (your own email) still works; anon simply types their name.
--    c) request_join gets gentle pending-request caps (per session, per email)
--       so an enumerated join code can't be used to flood a host's lobby.
--
-- Read-only where it matters, additive, safe to re-run.
-- ---------------------------------------------------------------------

-- 1) --- Richer public session payload -------------------------------------
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
                  'id', id, 'display_name', display_name, 'status', status, 'team_side', team_side)), '[]'::jsonb)
                from players where session_id = v_session.id),
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

grant execute on function get_public_session(text) to anon, authenticated;

-- 2a) --- Close the direct view back door -----------------------------------
-- The SECURITY DEFINER RPC above reads these as owner, so revoking public
-- SELECT does not affect spectating — it only stops anyone with the anon key
-- from querying every host's standings straight off the table.
revoke all on standings_live from anon, authenticated;
revoke all on standings_live_pairs from anon, authenticated;

-- 2b) --- lookup_guest: only your own email, only when signed in --------------
create or replace function lookup_guest(p_email text)
returns jsonb language plpgsql stable security definer as $$
declare
  v jsonb;
  v_caller text;
begin
  if char_length(coalesce(trim(p_email), '')) = 0 then
    return null;
  end if;
  -- Bind to the authenticated caller's own address — no anon PII oracle.
  v_caller := auth.jwt() ->> 'email';
  if v_caller is null or lower(v_caller) <> lower(trim(p_email)) then
    return null;
  end if;
  select jsonb_build_object('name', display_name, 'gender', gender, 'preferredSide', preferred_side)
    into v
    from join_requests
    where lower(email) = lower(trim(p_email))
    order by created_at desc
    limit 1;
  return v;
end;
$$;

revoke execute on function lookup_guest(text) from anon;
grant execute on function lookup_guest(text) to authenticated;

-- 2c) --- request_join: gentle anti-flood caps (anon join still works) --------
create or replace function request_join(
  p_code text,
  p_name text,
  p_gender text default 'M',
  p_team_side text default null,
  p_preferred_side text default null,
  p_email text default null
)
returns jsonb language plpgsql volatile security definer as $$
declare
  v_session sessions%rowtype;
  v_request_id uuid;
  v_email text := nullif(trim(coalesce(p_email, '')), '');
begin
  select * into v_session from sessions
    where join_code = p_code and status in ('draft','live');
  if not found then
    raise exception 'That code doesn''t match an open session.' using errcode = 'P0002';
  end if;
  if char_length(coalesce(trim(p_name), '')) = 0 then
    raise exception 'Please enter your name.' using errcode = 'P0001';
  end if;

  -- Anti-flood: cap total pending requests per session, and pending requests
  -- per email, so an enumerated code can't be used to spam a host's lobby.
  if (select count(*) from join_requests where session_id = v_session.id and status = 'pending') >= 200 then
    raise exception 'This session already has a lot of requests waiting — ask the host to review them.' using errcode = 'P0001';
  end if;
  if v_email is not null and (
       select count(*) from join_requests
       where session_id = v_session.id and status = 'pending' and lower(email) = lower(v_email)
     ) >= 3 then
    raise exception 'You already have a request waiting for the host to confirm.' using errcode = 'P0001';
  end if;

  insert into join_requests (session_id, display_name, gender, team_side, preferred_side, email)
    values (
      v_session.id,
      trim(p_name),
      case when p_gender in ('M','F') then p_gender else 'M' end,
      case when p_team_side in ('A','B') then p_team_side else null end,
      case when p_preferred_side in ('L','R') then p_preferred_side else null end,
      v_email
    )
    returning id into v_request_id;

  return jsonb_build_object(
    'requestId', v_request_id,
    'sessionId', v_session.id,
    'sessionName', v_session.name,
    'sessionStatus', v_session.status
  );
end;
$$;

grant execute on function request_join(text, text, text, text, text, text) to anon, authenticated;
