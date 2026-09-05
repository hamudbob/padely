-- ---------------------------------------------------------------------
-- 0060  Create a whole session in one call, so one can be started offline
--
-- WHY THIS EXISTS. Padel is played on courts with bad signal — that premise
-- is already all over this codebase, and scoreSyncQueue already makes SCORING
-- work with no bars. What still didn't work was STARTING: createLobby and
-- finalizeAndStart are a chain of six dependent inserts, each needing the ids
-- the previous one returned from the database. No connection, no ids, no
-- session, and a host standing on a court with twelve people waiting.
--
-- The encouraging part, on looking properly: the hard bit was never the
-- server. generateInitialRounds and generateNextRound both compute ON THE
-- PHONE — they read state from Supabase and write results back, but the
-- scheduling itself is local and always has been. The join code and public
-- token are generated on the device too. The only genuinely server-shaped
-- thing was the ids.
--
-- So the device now generates the whole object graph — ids and all — and this
-- function accepts it in one piece.
--
-- ── Why one function and not a queue of six inserts ──────────────────────
--
-- A generic write queue replaying six inserts in order has to solve, itself,
-- every problem this function gets for free: ordering, partial failure (a
-- session with courts and players but no rounds is worse than no session),
-- and retry after a half-applied batch. A function body is a transaction. All
-- of it lands or none of it does.
--
-- ── The three things it refuses to trust ─────────────────────────────────
--
-- 1. WHO. `created_by` is auth.uid(), never what the payload says. A payload
--    is a thing a client sends, and a client is a thing a person can edit.
-- 2. WHICH TEAM. Looked up from the caller's own team, exactly as createLobby
--    does. Passing a team_id would let anyone plant a session in someone
--    else's club.
-- 3. THE JOIN CODE. The device picks one from 900,000 possibilities without
--    being able to check it, so a collision is unlikely but not impossible —
--    and the failure would be a unique-violation on sync, hours later, with
--    the host's evening already recorded against it. On collision this
--    regenerates and REPORTS the change, so the app can tell the host their
--    code moved rather than silently serving a code that reaches a stranger's
--    session.
--
-- ── Idempotent, because a sync queue retries ─────────────────────────────
--
-- A flaky connection can deliver the same payload twice. Called again with a
-- session id that already exists and belongs to the caller, this returns the
-- existing row untouched and reports already_existed. It never half-writes and
-- never duplicates, which is what makes it safe to retry blindly.
--
-- Safe to run twice as a migration, too.
-- ---------------------------------------------------------------------

create or replace function create_session_from_payload(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_session      jsonb := p_payload -> 'session';
  v_session_id   uuid;
  v_team_id      uuid;
  v_club_id      uuid;
  v_join_code    text;
  v_public_token text;
  v_code_changed boolean := false;
  v_existing     record;
  v_attempt      int;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if v_session is null then
    raise exception 'Payload has no session.' using errcode = 'P0001';
  end if;

  v_session_id := (v_session ->> 'id')::uuid;
  if v_session_id is null then
    raise exception 'Payload session has no id.' using errcode = 'P0001';
  end if;

  -- ── Already here? ──────────────────────────────────────────────────────
  select id, join_code, public_token, created_by into v_existing
    from sessions where id = v_session_id;

  if found then
    if v_existing.created_by <> v_uid then
      -- Someone else's session id. Not a retry; refuse rather than touch it.
      raise exception 'That session belongs to someone else.' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'session_id',      v_existing.id,
      'join_code',       v_existing.join_code,
      'public_token',    v_existing.public_token,
      'already_existed', true,
      'code_changed',    false
    );
  end if;

  -- ── Whose team, and which club ────────────────────────────────────────
  select id into v_team_id from teams where owner_id = v_uid limit 1;
  if v_team_id is null then
    raise exception 'Could not find your team.' using errcode = 'P0001';
  end if;

  v_club_id := nullif(v_session ->> 'club_id', '')::uuid;
  if v_club_id is not null then
    -- A session can only be filed under a club the caller actually belongs to.
    -- Without this, an edited payload could push a session — and its results,
    -- and therefore its league points — into any club at all.
    if not exists (
      select 1 from club_members where club_id = v_club_id and user_id = v_uid
    ) then
      raise exception 'You are not a member of that club.' using errcode = 'P0001';
    end if;
  end if;

  v_join_code    := v_session ->> 'join_code';
  v_public_token := v_session ->> 'public_token';

  -- ── The session row, retrying on a code collision ─────────────────────
  for v_attempt in 1..5 loop
    begin
      insert into sessions (
        id, team_id, club_id, name, format, scoring_format, ranking_basis,
        status, join_code, public_token, scheduling_seed, min_players_per_court,
        team_score_mode, fixed_partner_style, counts_for_league,
        created_by, created_at, started_at
      ) values (
        v_session_id,
        v_team_id,
        v_club_id,
        v_session ->> 'name',
        v_session ->> 'format',
        v_session ->> 'scoring_format',
        v_session ->> 'ranking_basis',
        coalesce(v_session ->> 'status', 'live'),
        v_join_code,
        v_public_token,
        (v_session ->> 'scheduling_seed')::bigint,
        coalesce((v_session ->> 'min_players_per_court')::int, 4),
        nullif(v_session ->> 'team_score_mode', ''),
        nullif(v_session ->> 'fixed_partner_style', ''),
        -- A session with no club never counts for a league, whatever the
        -- payload claims.
        case when v_club_id is null then false
             else coalesce((v_session ->> 'counts_for_league')::boolean, true) end,
        v_uid,
        -- The device's clock, kept: this session really did start when the
        -- host pressed Start on the court, not when their phone found signal
        -- in the car park an hour later. Every round and score hangs off that
        -- time, and rewriting it to now() would file the whole evening under
        -- the wrong day.
        coalesce((v_session ->> 'created_at')::timestamptz, now()),
        coalesce((v_session ->> 'started_at')::timestamptz, now())
      );
      exit; -- inserted
    exception when unique_violation then
      -- Only the code and the token can collide here; the id was checked above.
      v_join_code    := lpad((floor(random() * 1000000))::int::text, 6, '0');
      v_public_token := encode(gen_random_bytes(16), 'hex');
      v_code_changed := true;
      if v_attempt = 5 then
        raise exception 'Could not find a free join code.' using errcode = 'P0001';
      end if;
    end;
  end loop;

  -- ── The graph, in dependency order ────────────────────────────────────
  --
  -- Every id comes from the device. That is the whole point: the phone built
  -- this while offline and every reference inside it already resolves.

  insert into courts (id, session_id, ordinal, display_name, available)
  select (c ->> 'id')::uuid, v_session_id, (c ->> 'ordinal')::int,
         c ->> 'display_name', coalesce((c ->> 'available')::boolean, true)
    from jsonb_array_elements(coalesce(p_payload -> 'courts', '[]'::jsonb)) as c;

  insert into players (id, session_id, display_name, gender, linked_user_id,
                       team_side, preferred_side, status, joined_at)
  select (pl ->> 'id')::uuid, v_session_id, pl ->> 'display_name',
         coalesce(pl ->> 'gender', 'M'),
         nullif(pl ->> 'linked_user_id', '')::uuid,
         nullif(pl ->> 'team_side', ''),
         nullif(pl ->> 'preferred_side', ''),
         coalesce(pl ->> 'status', 'active'),
         coalesce((pl ->> 'joined_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload -> 'players', '[]'::jsonb)) as pl;

  insert into pairs (id, session_id, label, is_auto_label, team_side, player_a_id, player_b_id)
  select (pr ->> 'id')::uuid, v_session_id, pr ->> 'label',
         coalesce((pr ->> 'is_auto_label')::boolean, true),
         nullif(pr ->> 'team_side', ''),
         (pr ->> 'player_a_id')::uuid, (pr ->> 'player_b_id')::uuid
    from jsonb_array_elements(coalesce(p_payload -> 'pairs', '[]'::jsonb)) as pr;

  insert into rounds (id, session_id, sequence, status, generation_reason, seed_used, generated_at)
  select (r ->> 'id')::uuid, v_session_id, (r ->> 'sequence')::int,
         coalesce(r ->> 'status', 'planned'), r ->> 'generation_reason',
         (r ->> 'seed_used')::bigint,
         coalesce((r ->> 'generated_at')::timestamptz, now())
    from jsonb_array_elements(coalesce(p_payload -> 'rounds', '[]'::jsonb)) as r;

  insert into round_rests (round_id, player_id, consecutive_rest_count)
  select (rr ->> 'round_id')::uuid, (rr ->> 'player_id')::uuid,
         coalesce((rr ->> 'consecutive_rest_count')::int, 0)
    from jsonb_array_elements(coalesce(p_payload -> 'rests', '[]'::jsonb)) as rr;

  -- Scores come across too. A host who played six rounds in a dead zone has
  -- six rounds of real results on their phone, and dropping them on sync in
  -- favour of "the queue will catch up" would lose the evening.
  insert into matches (id, round_id, court_id, pair_a_id, pair_b_id,
                       score_a, score_b, outcome, status)
  select (m ->> 'id')::uuid, (m ->> 'round_id')::uuid, (m ->> 'court_id')::uuid,
         nullif(m ->> 'pair_a_id', '')::uuid, nullif(m ->> 'pair_b_id', '')::uuid,
         nullif(m ->> 'score_a', '')::int, nullif(m ->> 'score_b', '')::int,
         nullif(m ->> 'outcome', ''),
         coalesce(m ->> 'status', 'not_started')
    from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m;

  insert into match_participants (match_id, player_id, side)
  select (mp ->> 'match_id')::uuid, (mp ->> 'player_id')::uuid, mp ->> 'side'
    from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]'::jsonb)) as mp;

  return jsonb_build_object(
    'session_id',      v_session_id,
    'join_code',       v_join_code,
    'public_token',    v_public_token,
    'already_existed', false,
    'code_changed',    v_code_changed
  );
end;
$$;

revoke execute on function create_session_from_payload(jsonb) from anon;
grant  execute on function create_session_from_payload(jsonb) to authenticated;

comment on function create_session_from_payload(jsonb) is
  'Creates a complete session (courts, players, pairs, rounds, rests, matches, participants) from a device-built payload, in one transaction. For sessions started offline. Idempotent on session id; forces created_by and team_id server-side; regenerates a colliding join code and reports it.';
