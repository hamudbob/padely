-- ---------------------------------------------------------------------
-- 0061  Push a live session's current state, and pull back what the phone
--       could not have seen
--
-- WHY. Tapping "Next Round" online costs about ten round trips: six reads to
-- gather rows, three writes, then the screen reloads the snapshot, the round
-- history and the standings. Not one of them is doing any thinking — the
-- draw, the standings and the fairness counters all already run on the
-- device. Supabase is storage, and the interface was blocking on storage.
--
-- So the phone becomes the source of truth for a session it is running, and
-- this function is how the server keeps up. Every local change — a score, a
-- round, a player marked as left, ending the night — applies instantly on the
-- device and is replicated a few seconds later by pushing the whole graph.
--
-- LOCAL-FIRST DOES NOT MEAN "SYNC LATER". With signal, this fires within
-- seconds; the server is never more than a moment behind. The only thing that
-- changed is that the UI stopped waiting for it.
--
-- ── Why the whole graph, and not a queue of individual operations ────────
--
-- A per-action queue (round.create, score.set, player.left) is more efficient
-- and has far more ways to be subtly wrong: ordering, partial application,
-- and a missed op that nothing ever notices. Pushing current state is
-- idempotent and SELF-HEALING — if any single push is lost, the next one
-- makes the server correct again, because it does not describe a change, it
-- describes the truth.
--
-- ── The one thing the phone does not own ─────────────────────────────────
--
-- Players who join by code. They write to the server directly, from their own
-- phone, and the host's device has never seen them. So this is an EXCHANGE,
-- not a push: it returns any players attached to the session that the payload
-- did not mention, for the device to merge into its roster.
--
-- That asymmetry is deliberate and is the safety property of the whole
-- design: this function NEVER DELETES. Rows the payload omits are left alone.
-- A host whose phone has not yet heard about a joiner cannot erase them by
-- syncing, which is exactly the accident a naive "replace state" would cause.
--
-- Rounds are the one exception, and only in one direction: a round the device
-- has deleted (Randomize, or discarding the current round) is removed
-- server-side, because the device genuinely is the only writer of rounds and
-- a stale round left behind would show spectators a draw that no longer
-- exists. Only rounds AFTER the highest sequence the payload still contains
-- are removed, so a lagging push can never delete history.
--
-- Idempotent, and safe to run twice as a migration.
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
  -- Only the host replicates. A player's phone has its own, much smaller,
  -- write surface (their join, their claim) and must never be able to push a
  -- whole session state over the host's.
  if v_owner <> v_uid then
    raise exception 'That session belongs to someone else.' using errcode = 'P0001';
  end if;

  -- ── The session row itself ────────────────────────────────────────────
  -- Only the fields a running session can actually change. Name, format and
  -- scoring are settled at creation; letting a replication rewrite them would
  -- turn a stale payload into a silent config change mid-evening.
  update sessions
     set status     = coalesce(v_session ->> 'status', status),
         ended_at   = nullif(v_session ->> 'ended_at', '')::timestamptz,
         updated_at = now()
   where id = v_session_id;

  -- ── Players: upsert, never delete ─────────────────────────────────────
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

  -- ── Rounds ────────────────────────────────────────────────────────────
  insert into rounds (id, session_id, sequence, status, generation_reason, seed_used, generated_at)
  select (r ->> 'id')::uuid, v_session_id, (r ->> 'sequence')::int,
         coalesce(r ->> 'status', 'planned'), r ->> 'generation_reason',
         (r ->> 'seed_used')::bigint,
         coalesce((r ->> 'generated_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r
  on conflict (id) do update set status = excluded.status;

  -- A round the device removed (Randomize, or discarding the current round)
  -- must go, or spectators keep seeing a draw that no longer exists. Bounded
  -- to rounds BEYOND the payload's highest sequence, so a stale push can
  -- never reach back and delete history. Matches, participants and rests
  -- cascade with it.
  select max((r ->> 'sequence')::int) into v_max_seq
    from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r;
  if v_max_seq is not null then
    delete from rounds
     where session_id = v_session_id
       and sequence <= v_max_seq
       and id not in (
         select (r ->> 'id')::uuid
           from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r
       );
  end if;

  insert into round_rests (round_id, player_id, consecutive_rest_count)
  select (rr ->> 'round_id')::uuid, (rr ->> 'player_id')::uuid,
         coalesce((rr ->> 'consecutive_rest_count')::int, 0)
    from jsonb_array_elements(coalesce(p_payload -> 'rests', '[]'::jsonb)) as rr
  on conflict (round_id, player_id) do nothing;

  insert into matches (id, round_id, court_id, pair_a_id, pair_b_id,
                       score_a, score_b, outcome, status)
  select (m ->> 'id')::uuid, (m ->> 'round_id')::uuid, (m ->> 'court_id')::uuid,
         nullif(m ->> 'pair_a_id', '')::uuid, nullif(m ->> 'pair_b_id', '')::uuid,
         nullif(m ->> 'score_a', '')::int, nullif(m ->> 'score_b', '')::int,
         nullif(m ->> 'outcome', ''),
         coalesce(m ->> 'status', 'not_started')
    from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m
  on conflict (id) do update
    set score_a = excluded.score_a,
        score_b = excluded.score_b,
        outcome = excluded.outcome,
        status  = excluded.status,
        updated_at = now();

  insert into match_participants (match_id, player_id, side)
  select (mp ->> 'match_id')::uuid, (mp ->> 'player_id')::uuid, mp ->> 'side'
    from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]'::jsonb)) as mp
  on conflict (match_id, player_id) do update set side = excluded.side;

  -- ── The pull half: players the device has never seen ─────────────────
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
  'Replicates a locally-owned live session to the server and returns players the device has not seen (code joiners). Upserts only — never deletes rows the payload omits, except rounds beyond the payload''s highest sequence. Host only.';
