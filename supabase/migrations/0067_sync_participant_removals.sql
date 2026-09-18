-- ---------------------------------------------------------------------
-- 0067  A swapped player stayed seated on the court they left
--
-- WHAT HAPPENED, 18 Sep 2026. A host opened a round history and found the
-- initial draw showing 3 v 3 on Court 1 and 3 v 5 on Court 2, with Firhan
-- and Iye on two courts at once and Nabil on three. Rounds 2-6 were clean.
--
-- ── The mechanism ──────────────────────────────────────────────────────
--
-- match_participants has primary key (match_id, player_id), and this
-- function only ever did:
--
--   insert ... on conflict (match_id, player_id) do update set side = ...
--
-- which can add a seat or change a side, but cannot say "this player has
-- LEFT that court". The lineup swap (swapLocalRoundPlayers, mirroring
-- swap_round_players from 0033) moves a player between matches, so the
-- device sends one row for the NEW seat. The old row is never matched by
-- the conflict target, never updated, never removed -- and the player is
-- seated on both courts from then on. Each swap added one more orphan.
--
-- The swap was server-only until 15 Sep and therefore inert on a
-- device-held session, which is why this never showed before: making the
-- button work is what started exercising the broken replication path.
--
-- ── The fix ────────────────────────────────────────────────────────────
--
-- Replication now makes the server's lineup MATCH the device's, rather
-- than only adding to it -- but only for matches the payload actually
-- describes a lineup for. Silence about a match is not an assertion that
-- it is empty, and treating it as one would let a partial push wipe a
-- round the device had nothing to say about. That distinction is the
-- whole reason this is a narrow `delete ... where exists`, not a
-- delete-everything-then-insert.
--
-- Identical to 0066 in every other respect. Idempotent.
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

  -- A seat the device has VACATED must be vacated here too.
  --
  -- The upsert above can add a seat and change a side, but it has no way to
  -- say "this player is no longer on that court". The primary key is
  -- (match_id, player_id), so when a lineup swap moves someone from Court 1 to
  -- Court 2 the device sends only the new seat, the old row is never matched,
  -- and the player ends up seated on BOTH courts. Every swap added another
  -- orphan; a round drawn for 8 players could end up showing 3 v 5.
  --
  -- Scope, deliberately narrow: only matches the payload actually describes a
  -- lineup FOR. A payload that carries a match but no participants for it is
  -- silent about that lineup, not asserting it is empty — deleting there would
  -- let a partial push wipe a round the device simply had nothing to say about.
  delete from match_participants mp
   where exists (
           select 1
             from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]'::jsonb)) as pp
            where (pp ->> 'match_id')::uuid = mp.match_id
         )
     and not exists (
           select 1
             from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]'::jsonb)) as pp
            where (pp ->> 'match_id')::uuid  = mp.match_id
              and (pp ->> 'player_id')::uuid = mp.player_id
         );

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
  'Replicates a locally-owned live session, its settings and its exact lineups included, and returns code-joiners the device has not seen. Deletes superseded rounds BEFORE inserting (rounds is unique on session_id+sequence, so a leftover collides and aborts the whole push). Never touches a sequence the payload is silent about, and never overwrites a recorded score with a local null. Host only.';
