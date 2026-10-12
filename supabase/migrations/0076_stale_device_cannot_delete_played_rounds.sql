-- ---------------------------------------------------------------------
-- 0076_stale_device_cannot_delete_played_rounds.sql
--
-- WHAT HAPPENED, 12 Oct 2026. A session ran on the web (to use co-hosts,
-- which the App Store build doesn't have yet). The host then opened the
-- same session in the iPhone app by accident. The app's copy had stopped at
-- round 1; the night was on round 7.
--
-- That phone's push said, in effect, "the session has one round". And
-- sync_session_state took a push's silence about rounds past its last one
-- as "the device threw these away" -- deleting rounds 2-7, scores and all,
-- unless a co-host had drawn them. A phone that is merely BEHIND looks
-- exactly like a phone that deleted the tail.
--
-- The same night showed the other half of it: a round drawn but not yet
-- scored vanished from the co-host's screen and a different one appeared.
-- Same cause -- the stale phone's push deleted the unplayed latest round,
-- and the next round was drawn again.
--
-- Now a push never deletes a round for being ABSENT. Rounds go only when:
--   * the device names them in discarded_round_ids (Delete, Refresh and
--     Randomize do, since 1.1), or
--   * the device redrew that same round number under a new id -- and only
--     if the round being replaced has no played match. A stale device's
--     round that would land on top of a played one is left out instead of
--     colliding on (session_id, sequence) and aborting the push.
--
-- The cost, on app versions before 1.1 only: deleting the current round on
-- the phone no longer removes it from the server. It stays there unscored,
-- which changes no rating or standing, and is replaced as soon as the host
-- draws that round again.
--
-- Identical to 0072 otherwise. Safe to re-run.
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
  v_skip       uuid[] := '{}';
  v_skip_m     uuid[] := '{}';
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
  -- Status moves one way under a push: an ENDED session is never made live
  -- again by a phone that still thinks it is (0072). The night may have been
  -- ended by the idle sweep, by the host on another device, or reopened by an
  -- admin -- in every case the server's word stands, and a reopen is an
  -- explicit act (reopen_session), never a side effect of replication.
  --
  -- A phone that ended the night itself still wins on WHEN: its ended_at is
  -- the real end, the sweep's is only when the server last heard anything.
  -- Except an end from before a reopen, which is stale by definition.
  update sessions
     set status     = case
                        when status = 'ended' then 'ended'
                        when v_session ->> 'status' = 'ended'
                             and reopened_at is not null
                             and coalesce(nullif(v_session ->> 'ended_at', '')::timestamptz, now()) < reopened_at
                          then status
                        when v_session ->> 'status' in ('draft', 'live', 'ended')
                          then v_session ->> 'status'
                        else status
                      end,
         ended_at   = case
                        when v_session ->> 'status' = 'ended'
                             and (reopened_at is null
                                  or coalesce(nullif(v_session ->> 'ended_at', '')::timestamptz, now()) >= reopened_at)
                          then coalesce(nullif(v_session ->> 'ended_at', '')::timestamptz, ended_at, now())
                        when status = 'ended' then ended_at
                        when v_session ->> 'status' = 'ended' then ended_at  -- a stale end, from before a reopen
                        else nullif(v_session ->> 'ended_at', '')::timestamptz
                      end,
         auto_ended = case
                        when v_session ->> 'status' = 'ended'
                             and (reopened_at is null
                                  or coalesce(nullif(v_session ->> 'ended_at', '')::timestamptz, now()) >= reopened_at)
                          then false
                        else auto_ended
                      end,
         last_activity_at = now(),
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
       -- 0076: ONLY a sequence the device has redrawn under a new id. Being
       -- silent about a round is never a reason to delete it any more: a
       -- device that is behind (the host's phone still on round 1 while the
       -- night is on round 7 elsewhere) is silent about every round it hasn't
       -- seen, and that used to delete them. Rounds the host really removed
       -- are named in discarded_round_ids (Delete / Refresh / Randomize send
       -- it since 1.1).
       and exists (
         select 1 from jsonb_array_elements(p_payload -> 'rounds') as r
          where (r ->> 'sequence')::int = s.sequence
       )
       -- and never a round that has been PLAYED. A stale device drawing its
       -- own round at the same number must not wipe out a scored one; its
       -- round is left out instead (v_skip, below).
       and not exists (select 1 from matches m where m.round_id = s.id and m.status = 'final');
  end if;

  -- Rounds the device deliberately deleted. Only ever this session's, and
  -- never one the same payload also carries.
  delete from rounds s
   where s.session_id = v_session_id
     and exists (
           select 1 from jsonb_array_elements_text(coalesce(p_payload -> 'discarded_round_ids', '[]'::jsonb)) as d(id)
            where d.id::uuid = s.id
         )
     and not exists (
           select 1 from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r
            where (r ->> 'id')::uuid = s.id
         );

  -- 0076: a round the device drew at a sequence the server already holds a
  -- PLAYED round for (kept above) is the stale one. Leave it out -- with its
  -- matches, lineups and rests -- rather than collide on (session_id,
  -- sequence) and abort the whole push, which is what 0064 exists to stop.
  -- The device learns it was skipped (skipped_rounds) and pulls.
  select coalesce(array_agg((r ->> 'id')::uuid), '{}') into v_skip
    from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r
   where exists (select 1 from rounds s
                  where s.session_id = v_session_id
                    and s.sequence = (r ->> 'sequence')::int
                    and s.id <> (r ->> 'id')::uuid);
  select coalesce(array_agg((m ->> 'id')::uuid), '{}') into v_skip_m
    from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m
   where (m ->> 'round_id')::uuid = any (v_skip);

  insert into rounds (id, session_id, sequence, status, generation_reason, seed_used, generated_at)
  select (r ->> 'id')::uuid, v_session_id, (r ->> 'sequence')::int,
         coalesce(r ->> 'status', 'planned'), r ->> 'generation_reason',
         (r ->> 'seed_used')::bigint,
         coalesce((r ->> 'generated_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r
   where not ((r ->> 'id')::uuid = any (v_skip))
  on conflict (id) do update set status = excluded.status;

  insert into round_rests (round_id, player_id, consecutive_rest_count)
  select (rr ->> 'round_id')::uuid, (rr ->> 'player_id')::uuid,
         coalesce((rr ->> 'consecutive_rest_count')::int, 0)
    from jsonb_array_elements(coalesce(p_payload -> 'rests', '[]'::jsonb)) as rr
   where not ((rr ->> 'round_id')::uuid = any (v_skip))
  on conflict (round_id, player_id) do nothing;

  -- ── Matches: a silent payload must not erase a recorded score ─────────
  insert into matches (id, round_id, court_id, pair_a_id, pair_b_id,
                       score_a, score_b, outcome, status, scored_at, scored_by)
  select (m ->> 'id')::uuid, (m ->> 'round_id')::uuid, (m ->> 'court_id')::uuid,
         nullif(m ->> 'pair_a_id', '')::uuid, nullif(m ->> 'pair_b_id', '')::uuid,
         nullif(m ->> 'score_a', '')::int, nullif(m ->> 'score_b', '')::int,
         nullif(m ->> 'outcome', ''),
         coalesce(m ->> 'status', 'not_started'),
         nullif(m ->> 'scored_at', '')::timestamptz,
         case when nullif(m ->> 'score_a', '') is not null then v_uid end
    from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m
   where not ((m ->> 'id')::uuid = any (v_skip_m))
  on conflict (id) do update
    set score_a = case when incoming_score_wins(excluded.score_a, excluded.scored_at, matches.scored_at, matches.scored_by, v_uid)
                       then excluded.score_a else matches.score_a end,
        score_b = case when incoming_score_wins(excluded.score_a, excluded.scored_at, matches.scored_at, matches.scored_by, v_uid)
                       then excluded.score_b else matches.score_b end,
        outcome = case when incoming_score_wins(excluded.score_a, excluded.scored_at, matches.scored_at, matches.scored_by, v_uid)
                       then excluded.outcome else matches.outcome end,
        -- Never walk a finished match back to not_started because the pushing
        -- device has no score for it -- nor overwrite a NEWER score with an
        -- older one.
        status  = case
                    when excluded.score_a is null and matches.status = 'final'
                      then matches.status
                    when excluded.score_a is not null
                     and not incoming_score_wins(excluded.score_a, excluded.scored_at, matches.scored_at, matches.scored_by, v_uid)
                      then matches.status
                    else excluded.status
                  end,
        scored_by = case when incoming_score_wins(excluded.score_a, excluded.scored_at, matches.scored_at, matches.scored_by, v_uid)
                          and (excluded.score_a is distinct from matches.score_a
                               or excluded.score_b is distinct from matches.score_b)
                         then v_uid else matches.scored_by end,
        scored_at = case when incoming_score_wins(excluded.score_a, excluded.scored_at, matches.scored_at, matches.scored_by, v_uid)
                         then coalesce(excluded.scored_at,
                                       case when excluded.score_a is distinct from matches.score_a
                                              or excluded.score_b is distinct from matches.score_b
                                            then now() else matches.scored_at end)
                         else matches.scored_at end,
        updated_at = now();

  insert into match_participants (match_id, player_id, side)
  select (mp ->> 'match_id')::uuid, (mp ->> 'player_id')::uuid, mp ->> 'side'
    from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]'::jsonb)) as mp
   where not ((mp ->> 'match_id')::uuid = any (v_skip_m))
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
         )
     and not (mp.match_id = any (v_skip_m));

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

  return jsonb_build_object('synced_at', now(), 'new_players', v_new_players,
                            'skipped_rounds', to_jsonb(v_skip));
end;
$$;


revoke execute on function sync_session_state(jsonb) from anon;
grant  execute on function sync_session_state(jsonb) to authenticated;
