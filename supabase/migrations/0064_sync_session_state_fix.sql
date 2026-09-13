-- ---------------------------------------------------------------------
-- 0064  Stop one tap on Randomize from silently ending a session's backup
--
-- WHAT HAPPENED, 12 Sep 2026. A host played a full evening — five or six
-- games each. The next morning the session showed four. Scores, ratings and
-- the club league row for that night were gone, and nothing had reported an
-- error to anybody at any point.
--
-- ── The mechanism, and it is entirely 0061's fault ─────────────────────
--
-- `rounds` carries `unique (session_id, sequence)` (0001_init.sql:110).
--
-- In 0061 the rounds INSERT (line 128) runs BEFORE the round-deletion clause
-- (line 144). Its conflict target is `(id)` alone. So a payload round carrying
-- a NEW id at a sequence the server already occupies does not take the
-- `on conflict (id)` path at all — it raises unique_violation on
-- rounds_session_id_sequence_key, which aborts the whole plpgsql function and
-- rolls the entire replication back.
--
-- That is exactly what Refresh, Randomize and Delete-round produce:
-- regenerateCurrentRound strips round N from localStorage and mints a
-- replacement with a fresh localUuid() at sequence N.
--
-- And replicateSession catches the error and console.warn()s it, under a
-- comment I wrote claiming a failed replication should stay invisible because
-- "telling them would be reporting our plumbing". So from the first tap of
-- Randomize the session was never backed up again, the host's screen stayed
-- perfect (it reads localStorage), spectators saw a frozen board, and the
-- truth only surfaced when the local rows were swept.
--
-- ── The fix is ORDER, not the comparison ──────────────────────────────
--
-- 0061's comment claims the delete is "bounded to rounds BEYOND the payload's
-- highest sequence, so a stale push can never reach back and delete history",
-- while the code says `sequence <= v_max_seq`. The comment is wrong, but so is
-- the instinct to simply flip it to `>`: the superseded round sits AT a
-- sequence the payload still occupies, so `>` would never reach it and
-- Randomize would stay broken.
--
-- What was actually missing is that the delete has to happen FIRST, and has to
-- name the two cases it is for:
--
--   1. a sequence the payload still occupies, held by a different id
--      (regenerate / randomize — the superseded round)
--   2. anything beyond the payload's highest sequence
--      (the device discarded the tail)
--
-- A sequence the payload says NOTHING about is left alone. That is the
-- property 0061's comment promised and never implemented, and it is what
-- stops a lagging or partial push from erasing history.
--
-- ── Second fix: a local null must not erase a real score ──────────────
--
-- The matches upsert assigned `score_a = excluded.score_a` unconditionally.
-- The payload is whatever the HOST'S localStorage holds, so a score that
-- reached the server another way — the host opening the same session on a
-- laptop, or a local write failing because the store was full — was
-- overwritten with null on the next push. Scores are now coalesced: a payload
-- that is silent about a score leaves the stored one alone, and a final match
-- is not walked back to not_started by a device that never saw it.
--
-- This costs the ability to CLEAR a score by replication. No client path does
-- that today (setLocalMatchScore is only ever called with both values
-- present). If clearing is ever wanted it needs an explicit tombstone, not a
-- null that is indistinguishable from "I don't know about this one".
--
-- Idempotent. Replaces the 0061 definition wholesale.
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

  update sessions
     set status     = coalesce(v_session ->> 'status', status),
         ended_at   = nullif(v_session ->> 'ended_at', '')::timestamptz,
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
  'Replicates a locally-owned live session and returns code-joiners the device has not seen. Deletes superseded rounds BEFORE inserting (rounds is unique on session_id+sequence, so a leftover collides and aborts the whole push). Never touches a sequence the payload is silent about, and never overwrites a recorded score with a local null. Host only.';
