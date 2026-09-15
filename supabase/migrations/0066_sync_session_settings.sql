-- ---------------------------------------------------------------------
-- 0066  The session's own settings never reached the server
--
-- WHAT HAPPENED, 15 Sep 2026. A host ran a best-of-4-games night. His phone
-- showed the right board. Everyone else -- the live spectator link, the
-- players, the shared final standings -- saw a different one: ordered by
-- points when he had chosen wins-first, and crediting rested players 10
-- points per missed match instead of 2.
--
-- ── The mechanism ──────────────────────────────────────────────────────
--
-- createLobby (sessionActions.ts:90) mints the server's session row EARLY,
-- at the lobby step, so players can join by code. It carries whatever config
-- exists at that moment.
--
-- finalizeAndStart (sessionActions.ts:158) used to overwrite that row with
-- the host's final choices. It is no longer called -- CreateSessionPage.tsx:24
-- says so outright: "finalizeAndStart is gone from this screen: Start is
-- local-first now, and the server session is created by the sync path
-- instead."
--
-- But the sync path wrote only `status` and `ended_at`. toSyncPayload sends
-- the whole session object (localSession.ts:543); sync_session_state read two
-- fields off it and dropped the rest. So the row froze at its lobby-time
-- values and nothing ever reconciled it.
--
-- Everyone except the host then computed the board from those stale values:
--   ranking_basis  -> wrong sort order
--   scoring_format -> wrong rest compensation, floor(max/2) per missed match
--                     (10 for fixed_21 vs 2 for fixed_4_games)
-- The host alone could not see it, because every host read short-circuits to
-- localStorage -- including the share link (publicSessionQueries.ts:172).
--
-- ── The fix ────────────────────────────────────────────────────────────
--
-- The device is the source of truth for its own session, so replication now
-- carries the session's settings alongside its matches. Values are
-- whitelisted, never passed through: an unrecognised setting is ignored
-- rather than raised, because aborting this function is what cost a host an
-- evening in 0064 and the scores matter more than the settings.
--
-- Identical to 0064 in every other respect. Idempotent.
-- ---------------------------------------------------------------------

create or replace function sync_session_state(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_session    jsonb := p_payload -> 'session';
  v_session_id uuid;
  v_owner      uuid;
  v_max_seq    int;
  v_new_players jsonb;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  v_session_id := (v_session ->> 'id')::uuid;
  if v_session_id is null then
    raise exception 'Payload session has no id.' using errcode = 'P0001';
  end if;

  select created_by into v_owner from sessions where id = v_session_id;
  if v_owner is null then
    raise exception 'That session does not exist here yet.' using errcode = 'P0001';
  end if;
  if v_owner <> v_uid then
    raise exception 'That session belongs to someone else.' using errcode = 'P0001';
  end if;

  -- The session's OWN settings, not just its lifecycle. See the header: the
  -- server row is minted by createLobby before the host has finished choosing,
  -- finalizeAndStart no longer runs, and nothing else ever corrected it.
  --
  -- Every value is whitelisted rather than passed through. A payload carrying
  -- a value the check constraints would reject must not raise here: this
  -- function's whole job is to get the night's SCORES to safety, and 0064
  -- exists because an abort in this function cost a host an entire evening.
  -- An unrecognised setting is therefore ignored, leaving the stored one.
  --
  -- Deliberately NOT synced: club_id and counts_for_league (0060 validates
  -- club membership before either is written, and letting a replication move
  -- a session between clubs would push league points into a club the host is
  -- not a member of), join_code, public_token, created_by and created_at.
  update sessions
     set status     = case when v_session ->> 'status' in ('draft', 'live', 'ended')
                           then v_session ->> 'status' else status end,
         ended_at   = nullif(v_session ->> 'ended_at', '')::timestamptz,
         started_at = coalesce(nullif(v_session ->> 'started_at', '')::timestamptz, started_at),
         name       = case when char_length(coalesce(v_session ->> 'name', '')) between 2 and 80
                           then v_session ->> 'name' else name end,
         format     = case when v_session ->> 'format' in
                             ('americano', 'mexicano', 'mix_americano', 'mix_mexicano',
                              'fixed_partner', 'team_sparring')
                           then v_session ->> 'format' else format end,
         scoring_format = case when v_session ->> 'scoring_format' in
                                 ('fixed_21', 'fixed_4_games', 'fixed_5_games', 'race_4', 'race_6')
                               then v_session ->> 'scoring_format' else scoring_format end,
         ranking_basis  = case when v_session ->> 'ranking_basis' in ('points_first', 'wins_first')
                               then v_session ->> 'ranking_basis' else ranking_basis end,
         team_score_mode = case when v_session ? 'team_score_mode'
                                then nullif(v_session ->> 'team_score_mode', '')
                                else team_score_mode end,
         fixed_partner_style = case when v_session ? 'fixed_partner_style'
                                    then nullif(v_session ->> 'fixed_partner_style', '')
                                    else fixed_partner_style end,
         min_players_per_court = coalesce((v_session ->> 'min_players_per_court')::int,
                                          min_players_per_court),
         updated_at = now()
   where id = v_session_id;

  insert into players (id, session_id, display_name, gender, linked_user_id,
                       team_side, preferred_side, status, joined_at)
  select (pl ->> 'id')::uuid, v_session_id, pl ->> 'display_name',
         coalesce(pl ->> 'gender', 'M'),
         nullif(pl ->> 'linked_user_id', '')::uuid,
         nullif(pl ->> 'team_side', ''),
         nullif(pl ->> 'preferred_side', ''),
         coalesce(pl ->> 'status', 'active'),
         coalesce((pl ->> 'joined_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload -> 'players', '[]'::jsonb)) as pl
  on conflict (id) do update
    set display_name = excluded.display_name,
        status       = excluded.status,
        team_side    = excluded.team_side,
        preferred_side = excluded.preferred_side;

  insert into courts (id, session_id, ordinal, display_name, available)
  select (c ->> 'id')::uuid, v_session_id, (c ->> 'ordinal')::int,
         c ->> 'display_name', coalesce((c ->> 'available')::boolean, true)
    from jsonb_array_elements(coalesce(p_payload -> 'courts', '[]'::jsonb)) as c
  on conflict (id) do update
    set display_name = excluded.display_name,
        available    = excluded.available;

  insert into pairs (id, session_id, label, is_auto_label, team_side, player_a_id, player_b_id)
  select (pr ->> 'id')::uuid, v_session_id, pr ->> 'label',
         coalesce((pr ->> 'is_auto_label')::boolean, true),
         nullif(pr ->> 'team_side', ''),
         (pr ->> 'player_a_id')::uuid, (pr ->> 'player_b_id')::uuid
    from jsonb_array_elements(coalesce(p_payload -> 'pairs', '[]'::jsonb)) as pr
  on conflict (id) do update set label = excluded.label;

  -- ── Rounds: CLEAR THE WAY FIRST, then insert ──────────────────────────
  --
  -- This delete has to precede the insert. `rounds` is unique on
  -- (session_id, sequence), so a superseded round left standing makes the
  -- insert raise unique_violation and takes the whole replication down with
  -- it — permanently, because every later push fails identically.
  select max((r ->> 'sequence')::int) into v_max_seq
    from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r;

  if v_max_seq is not null then
    -- not exists, not `not in`: a single null id in the payload would make
    -- `not in` evaluate to null and quietly delete nothing at all.
    delete from rounds s
     where s.session_id = v_session_id
       and not exists (
         select 1 from jsonb_array_elements(p_payload -> 'rounds') as r
          where (r ->> 'id')::uuid = s.id
       )
       and (
         -- the device discarded the tail
         s.sequence > v_max_seq
         -- or this sequence was regenerated under a new id
         or exists (
           select 1 from jsonb_array_elements(p_payload -> 'rounds') as r
            where (r ->> 'sequence')::int = s.sequence
         )
       );
  end if;

  insert into rounds (id, session_id, sequence, status, generation_reason, seed_used, generated_at)
  select (r ->> 'id')::uuid, v_session_id, (r ->> 'sequence')::int,
         coalesce(r ->> 'status', 'planned'), r ->> 'generation_reason',
         (r ->> 'seed_used')::bigint,
         coalesce((r ->> 'generated_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r
  on conflict (id) do update set status = excluded.status;

  insert into round_rests (round_id, player_id, consecutive_rest_count)
  select (rr ->> 'round_id')::uuid, (rr ->> 'player_id')::uuid,
         coalesce((rr ->> 'consecutive_rest_count')::int, 0)
    from jsonb_array_elements(coalesce(p_payload -> 'rests', '[]'::jsonb)) as rr
  on conflict (round_id, player_id) do nothing;

  -- ── Matches: a silent payload must not erase a recorded score ─────────
  insert into matches (id, round_id, court_id, pair_a_id, pair_b_id,
                       score_a, score_b, outcome, status)
  select (m ->> 'id')::uuid, (m ->> 'round_id')::uuid, (m ->> 'court_id')::uuid,
         nullif(m ->> 'pair_a_id', '')::uuid, nullif(m ->> 'pair_b_id', '')::uuid,
         nullif(m ->> 'score_a', '')::int, nullif(m ->> 'score_b', '')::int,
         nullif(m ->> 'outcome', ''),
         coalesce(m ->> 'status', 'not_started')
    from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m
  on conflict (id) do update
    set score_a = coalesce(excluded.score_a, matches.score_a),
        score_b = coalesce(excluded.score_b, matches.score_b),
        outcome = coalesce(excluded.outcome, matches.outcome),
        -- Never walk a finished match back to not_started because the pushing
        -- device has no score for it.
        status  = case
                    when excluded.score_a is null and matches.status = 'final'
                      then matches.status
                    else excluded.status
                  end,
        updated_at = now();

  insert into match_participants (match_id, player_id, side)
  select (mp ->> 'match_id')::uuid, (mp ->> 'player_id')::uuid, mp ->> 'side'
    from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]'::jsonb)) as mp
  on conflict (match_id, player_id) do update set side = excluded.side;

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_new_players
    from (
      select id, display_name, gender, linked_user_id, team_side,
             preferred_side, status, joined_at
        from players
       where session_id = v_session_id
         and id not in (
           select (pl ->> 'id')::uuid
             from jsonb_array_elements(coalesce(p_payload -> 'players', '[]'::jsonb)) as pl
         )
    ) p;

  return jsonb_build_object('synced_at', now(), 'new_players', v_new_players);
end;
$$;

revoke execute on function sync_session_state(jsonb) from anon;
grant  execute on function sync_session_state(jsonb) to authenticated;

comment on function sync_session_state(jsonb) is
  'Replicates a locally-owned live session, its settings included, and returns code-joiners the device has not seen. Deletes superseded rounds BEFORE inserting (rounds is unique on session_id+sequence, so a leftover collides and aborts the whole push). Never touches a sequence the payload is silent about, and never overwrites a recorded score with a local null. Host only.';
