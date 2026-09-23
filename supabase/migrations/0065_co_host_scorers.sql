-- ---------------------------------------------------------------------
-- 0065_co_host_scorers.sql
--
-- CO-HOSTS. A host can name other signed-in users as scorers on one of
-- their sessions. A scorer may do exactly two things: enter a match score,
-- and advance to the next round in the formats that draw one round at a
-- time. Nothing else. They cannot end the session, mark a player left,
-- add a late player, change settings, rename a court, redraw, randomize,
-- delete a round, or touch any other session.
--
-- WHY RPCs AND NOT AN RLS POLICY
--
-- The obvious shape is a second permissive policy on `matches` for
-- scorers. It is the wrong shape. RLS gates ROWS, never COLUMNS, and
-- `matches` carries no column-level grants, so `for update` to a scorer
-- would hand them `court_id`, `pair_a_id` and `pair_b_id` alongside the
-- score -- i.e. the ability to silently rewrite who played whom. That is
-- the same trap 0062 closed on `profiles`. So the write surface here is
-- two narrow SECURITY DEFINER functions with an explicit column list, and
-- `matches` keeps exactly one write policy: `host_all_matches`.
--
-- The read is its own function too, rather than widening
-- get_public_session, so that a scorer's richer view (court ids, gender,
-- rest counts) is never handed to anonymous spectators.
--
-- sync_session_state (0064) and create_session_from_payload (0060) stay
-- owner-only. They rewrite the whole session graph; a scorer must never
-- reach them.
--
-- Additive & safe to re-run.
-- ---------------------------------------------------------------------

-- --- 1. Who may score ---------------------------------------------------

create table if not exists session_scorers (
  session_id uuid not null references sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  added_by   uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index if not exists session_scorers_user_idx on session_scorers (user_id);

alter table session_scorers enable row level security;

-- The host owns the list outright. `added_by = auth.uid()` on the check
-- keeps the audit column honest: you cannot record someone else as the
-- person who handed out the rights.
drop policy if exists host_all_session_scorers on session_scorers;
create policy host_all_session_scorers on session_scorers for all to authenticated
  using (is_session_host(session_id))
  with check (is_session_host(session_id) and added_by = auth.uid());

-- A scorer may see that they are one -- and nothing about anyone else.
drop policy if exists scorer_read_own on session_scorers;
create policy scorer_read_own on session_scorers for select to authenticated
  using (user_id = auth.uid());

-- --- 2. The gate --------------------------------------------------------

-- Deliberately mirrors is_session_host(uuid) from 0001: stable, security
-- definer, pinned search_path. Revoked from anon -- an anonymous watcher is
-- never a scorer, and this should not be callable as an oracle.
create or replace function is_session_scorer(p_session_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from session_scorers
     where session_id = p_session_id
       and user_id = auth.uid()
  );
$$;

revoke all on function is_session_scorer(uuid) from public, anon;
grant execute on function is_session_scorer(uuid) to authenticated;

-- Convenience: host OR scorer. Used by all three functions below so the
-- host always retains every right a scorer has.
create or replace function can_score_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_session_host(p_session_id) or is_session_scorer(p_session_id);
$$;

revoke all on function can_score_session(uuid) from public, anon;
grant execute on function can_score_session(uuid) to authenticated;

-- --- 3. Server-side score validation ------------------------------------

-- A faithful port of validateAndDeriveScore() in src/lib/scoring/formats.ts.
-- The client validates too, for the error message; this exists so the
-- server never trusts a number it was handed. Fixed-sum formats derive
-- B from A exactly as the client does, so one tap still means one call.
create or replace function derive_match_score(p_format text, p_score_a int, p_score_b int)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_total   int;
  v_target  int;
  v_b       int;
  v_outcome text;
begin
  if p_score_a is null then
    raise exception 'Enter a score.' using errcode = 'P0001';
  end if;
  if p_score_a < 0 then
    raise exception 'Scores must be non-negative.' using errcode = 'P0001';
  end if;

  if p_format in ('fixed_21', 'fixed_4_games', 'fixed_5_games') then
    v_total := case p_format
                 when 'fixed_21'      then 21
                 when 'fixed_4_games' then 4
                 else 5
               end;
    if p_score_a > v_total then
      raise exception 'Score must be an integer from 0 to %.', v_total using errcode = 'P0001';
    end if;
    v_b := coalesce(p_score_b, v_total - p_score_a);
    if v_b < 0 or p_score_a + v_b <> v_total then
      raise exception 'Total must sum to %.', v_total using errcode = 'P0001';
    end if;

  elsif p_format in ('race_4', 'race_6') then
    v_target := case p_format when 'race_4' then 4 else 6 end;
    if p_score_b is null then
      raise exception 'Enter both teams'' scores.' using errcode = 'P0001';
    end if;
    v_b := p_score_b;
    if v_b < 0 then
      raise exception 'Scores must be non-negative.' using errcode = 'P0001';
    end if;
    if greatest(p_score_a, v_b) <> v_target then
      raise exception 'Winner must have exactly %.', v_target using errcode = 'P0001';
    end if;
    if least(p_score_a, v_b) >= v_target then
      raise exception 'Loser''s score must be between 0 and %.', v_target - 1 using errcode = 'P0001';
    end if;
    if p_score_a = v_b then
      raise exception 'A race format cannot end in a draw.' using errcode = 'P0001';
    end if;

  else
    raise exception 'Unknown scoring format %.', p_format using errcode = 'P0001';
  end if;

  v_outcome := case
                 when p_score_a = v_b then 'draw'
                 when p_score_a > v_b then 'win_a'
                 else 'win_b'
               end;

  return jsonb_build_object('score_a', p_score_a, 'score_b', v_b, 'outcome', v_outcome);
end;
$$;

revoke all on function derive_match_score(text, int, int) from public, anon;
grant execute on function derive_match_score(text, int, int) to authenticated;

-- --- 4. What a scorer can see -------------------------------------------

-- Everything the scheduler needs to draw the next round, and nothing more.
-- Note the deliberate extras over get_public_session: court_id and ordinal
-- (so a generated round can be mapped onto real courts), player gender and
-- preferred_side (mix/side formats), and round_rests (rest fairness).
create or replace function get_scorer_session(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_session sessions%rowtype;
  v_result  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if not can_score_session(p_session_id) then
    raise exception 'You are not scoring this session.' using errcode = 'P0001';
  end if;

  select * into v_session from sessions where id = p_session_id;
  if not found then
    raise exception 'That session does not exist.' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'name', v_session.name,
      'format', v_session.format,
      'scoring_format', v_session.scoring_format,
      'ranking_basis', v_session.ranking_basis,
      'fixed_partner_style', v_session.fixed_partner_style,
      'team_score_mode', v_session.team_score_mode,
      'min_players_per_court', v_session.min_players_per_court,
      'scheduling_seed', v_session.scheduling_seed,
      'status', v_session.status
    ),
    'courts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'ordinal', ordinal,
               'display_name', display_name, 'available', available
             ) order by ordinal), '[]'::jsonb)
      from courts where session_id = v_session.id
    ),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'display_name', display_name, 'gender', gender,
               'status', status, 'team_side', team_side,
               'preferred_side', preferred_side,
               'matches_played', matches_played, 'rests', rests
             )), '[]'::jsonb)
      from players where session_id = v_session.id
    ),
    'pairs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'label', label, 'team_side', team_side,
               'player_a_id', player_a_id, 'player_b_id', player_b_id
             )), '[]'::jsonb)
      from pairs where session_id = v_session.id
    ),
    'rounds', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'sequence', sequence, 'status', status
             ) order by sequence), '[]'::jsonb)
      from rounds where session_id = v_session.id
    ),
    'round_rests', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'round_id', rr.round_id, 'player_id', rr.player_id,
               'consecutive_rest_count', rr.consecutive_rest_count
             )), '[]'::jsonb)
      from round_rests rr
      join rounds r on r.id = rr.round_id
      where r.session_id = v_session.id
    ),
    'adjustments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'player_id', player_id, 'pair_id', pair_id, 'amount', amount
             )), '[]'::jsonb)
      from adjustments where session_id = v_session.id
    ),
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id,
               'round_id', m.round_id,
               'court_id', m.court_id,
               'pair_a_id', m.pair_a_id,
               'pair_b_id', m.pair_b_id,
               'status', m.status,
               'outcome', m.outcome,
               'score_a', m.score_a,
               'score_b', m.score_b,
               'updated_at', m.updated_at,
               'participants', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'player_id', mp.player_id, 'side', mp.side
                        )), '[]'::jsonb)
                 from match_participants mp where mp.match_id = m.id
               )
             ) order by r.sequence), '[]'::jsonb)
      from matches m
      join rounds r on r.id = m.round_id
      where r.session_id = v_session.id
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function get_scorer_session(uuid) from public, anon;
grant execute on function get_scorer_session(uuid) to authenticated;

-- --- 5. Entering a score ------------------------------------------------

-- The ONLY columns this writes are score_a, score_b, outcome, status and
-- updated_at. A scorer cannot reach court_id or the pair columns through
-- it, which is the whole reason it exists instead of an RLS policy.
create or replace function submit_score_as_scorer(
  p_match_id uuid,
  p_score_a  int,
  p_score_b  int   default null,
  p_reason   text  default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_session    sessions%rowtype;
  v_match      matches%rowtype;
  v_derived    jsonb;
  v_was_final  boolean;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;

  select m.* into v_match from matches m where m.id = p_match_id;
  if not found then
    raise exception 'That match does not exist.' using errcode = 'P0002';
  end if;

  select s.* into v_session
    from sessions s
    join rounds r on r.session_id = s.id
   where r.id = v_match.round_id;
  if not found then
    raise exception 'That match is not attached to a session.' using errcode = 'P0002';
  end if;

  if not can_score_session(v_session.id) then
    raise exception 'You are not scoring this session.' using errcode = 'P0001';
  end if;

  -- A finished night is finished. The host reopens it, nobody else.
  if v_session.status <> 'live' then
    raise exception 'This session is not live.' using errcode = 'P0001';
  end if;

  if v_match.status = 'cancelled' then
    raise exception 'That match was cancelled.' using errcode = 'P0001';
  end if;

  v_derived := derive_match_score(v_session.scoring_format, p_score_a, p_score_b);
  v_was_final := v_match.status = 'final';

  update matches
     set score_a    = (v_derived ->> 'score_a')::int,
         score_b    = (v_derived ->> 'score_b')::int,
         outcome    = (v_derived ->> 'outcome'),
         status     = 'final',
         updated_at = now()
   where id = p_match_id;

  -- Same audit row the host's path writes, so a corrected score always
  -- names the person who corrected it.
  if v_was_final then
    insert into score_edits (match_id, old_score_a, old_score_b, new_score_a, new_score_b, edited_by, reason)
    values (p_match_id, v_match.score_a, v_match.score_b,
            (v_derived ->> 'score_a')::int, (v_derived ->> 'score_b')::int,
            v_uid, p_reason);
  end if;

  return v_derived;
end;
$$;

revoke all on function submit_score_as_scorer(uuid, int, int, text) from public, anon;
grant execute on function submit_score_as_scorer(uuid, int, int, text) to authenticated;

-- --- 6. Advancing the round ---------------------------------------------

-- Mexicano and rank-based Fixed Partner draw each round from the standings
-- of the one before, so a night with a late host stalls after round 1
-- unless someone can advance it. The scheduler itself lives in TypeScript
-- (src/lib/scheduling/), so this takes a round the client has already
-- generated and appends it -- under validation strict enough that a
-- hostile payload cannot do anything a legitimate one could not.
--
-- Specifically it refuses to: write anywhere but max(sequence) + 1; name a
-- court, player or pair belonging to another session; seat a player who
-- has left; seat the same player twice in a round; put two matches on one
-- court; or run at all while a match is still unscored.
create or replace function append_round_as_scorer(p_session_id uuid, p_round jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_session   sessions%rowtype;
  v_pregen    boolean;
  v_next_seq  int;
  v_seq       int;
  v_round_id  uuid;
  v_match     jsonb;
  v_part      jsonb;
  v_rest      jsonb;
  v_seen_players uuid[] := '{}';
  v_seen_courts  uuid[] := '{}';
  v_player_id uuid;
  v_court_id  uuid;
  v_match_id  uuid;
  v_count     int := 0;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if not can_score_session(p_session_id) then
    raise exception 'You are not scoring this session.' using errcode = 'P0001';
  end if;

  select * into v_session from sessions where id = p_session_id;
  if not found then
    raise exception 'That session does not exist.' using errcode = 'P0002';
  end if;
  if v_session.status <> 'live' then
    raise exception 'This session is not live.' using errcode = 'P0001';
  end if;

  -- Mirrors isFullyPreGeneratedFormat() in src/lib/scheduling/initialSchedule.ts.
  -- Those formats lay the whole night out at creation, so there is nothing
  -- to append and an extra round would be off-schedule.
  if v_session.fixed_partner_style = 'round_robin' then
    v_pregen := true;
  elsif v_session.fixed_partner_style = 'rank_based' then
    v_pregen := false;
  else
    v_pregen := v_session.format in
      ('americano', 'team_sparring', 'mix_americano', 'side_americano', 'fixed_partner');
  end if;

  if v_pregen then
    raise exception 'Every round of this format is created up front.' using errcode = 'P0001';
  end if;

  -- Nothing is drawn from a half-finished standings table.
  if exists (
    select 1 from matches m
      join rounds r on r.id = m.round_id
     where r.session_id = p_session_id
       and m.status not in ('final', 'cancelled')
  ) then
    raise exception 'Finish scoring every match first.' using errcode = 'P0001';
  end if;

  select coalesce(max(sequence), 0) + 1 into v_next_seq
    from rounds where session_id = p_session_id;

  v_seq := (p_round ->> 'sequence')::int;
  if v_seq is null then
    v_seq := v_next_seq;
  end if;
  if v_seq <> v_next_seq then
    raise exception 'The next round is number %, not %.', v_next_seq, v_seq using errcode = 'P0001';
  end if;

  -- The client may propose an id; it must not collide with anything.
  v_round_id := coalesce((p_round ->> 'id')::uuid, gen_random_uuid());
  if exists (select 1 from rounds where id = v_round_id) then
    raise exception 'That round already exists.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_round -> 'matches') <> 'array'
     or jsonb_array_length(p_round -> 'matches') = 0 then
    raise exception 'A round needs at least one match.' using errcode = 'P0001';
  end if;

  -- seed_used is a NOT NULL bigint, and generation_reason a NOT NULL text.
  -- A payload that omits either must still produce a legal row, so both fall
  -- back rather than failing the night with a constraint error.
  insert into rounds (id, session_id, sequence, status, generation_reason, seed_used, generated_at)
  values (v_round_id, p_session_id, v_seq, 'planned',
          coalesce(nullif(trim(p_round ->> 'generation_reason'), ''), 'advanced by co-host'),
          coalesce((p_round ->> 'seed_used')::bigint, v_session.scheduling_seed),
          now());

  for v_match in select * from jsonb_array_elements(p_round -> 'matches') loop
    v_court_id := (v_match ->> 'court_id')::uuid;
    if v_court_id is null then
      raise exception 'Every match needs a court.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from courts where id = v_court_id and session_id = p_session_id) then
      raise exception 'That court is not part of this session.' using errcode = 'P0001';
    end if;
    if v_court_id = any (v_seen_courts) then
      raise exception 'Two matches cannot share a court in one round.' using errcode = 'P0001';
    end if;
    v_seen_courts := v_seen_courts || v_court_id;

    -- Pairs, when the format uses them, must also be this session's.
    if (v_match ->> 'pair_a_id') is not null
       and not exists (select 1 from pairs where id = (v_match ->> 'pair_a_id')::uuid and session_id = p_session_id) then
      raise exception 'That pair is not part of this session.' using errcode = 'P0001';
    end if;
    if (v_match ->> 'pair_b_id') is not null
       and not exists (select 1 from pairs where id = (v_match ->> 'pair_b_id')::uuid and session_id = p_session_id) then
      raise exception 'That pair is not part of this session.' using errcode = 'P0001';
    end if;

    v_match_id := coalesce((v_match ->> 'id')::uuid, gen_random_uuid());
    if exists (select 1 from matches where id = v_match_id) then
      raise exception 'That match already exists.' using errcode = 'P0001';
    end if;

    insert into matches (id, round_id, court_id, pair_a_id, pair_b_id, status)
    values (v_match_id, v_round_id, v_court_id,
            (v_match ->> 'pair_a_id')::uuid, (v_match ->> 'pair_b_id')::uuid,
            'not_started');

    for v_part in select * from jsonb_array_elements(v_match -> 'participants') loop
      v_player_id := (v_part ->> 'player_id')::uuid;
      if (v_part ->> 'side') not in ('A', 'B') then
        raise exception 'A player must be on side A or B.' using errcode = 'P0001';
      end if;
      if not exists (
        select 1 from players
         where id = v_player_id and session_id = p_session_id and status <> 'left'
      ) then
        raise exception 'That player is not active in this session.' using errcode = 'P0001';
      end if;
      if v_player_id = any (v_seen_players) then
        raise exception 'A player cannot be on two courts in one round.' using errcode = 'P0001';
      end if;
      v_seen_players := v_seen_players || v_player_id;

      insert into match_participants (match_id, player_id, side)
      values (v_match_id, v_player_id, v_part ->> 'side');
    end loop;

    v_count := v_count + 1;
  end loop;

  -- Whoever sits out. Same session check; a resting player must not also
  -- be on a court this round.
  if jsonb_typeof(p_round -> 'rests') = 'array' then
    for v_rest in select * from jsonb_array_elements(p_round -> 'rests') loop
      v_player_id := (v_rest ->> 'player_id')::uuid;
      if not exists (
        select 1 from players
         where id = v_player_id and session_id = p_session_id and status <> 'left'
      ) then
        raise exception 'That player is not active in this session.' using errcode = 'P0001';
      end if;
      if v_player_id = any (v_seen_players) then
        raise exception 'A player cannot both rest and play in one round.' using errcode = 'P0001';
      end if;
      insert into round_rests (round_id, player_id, consecutive_rest_count)
      values (v_round_id, v_player_id,
              coalesce((v_rest ->> 'consecutive_rest_count')::int, 0))
      on conflict (round_id, player_id) do nothing;
    end loop;
  end if;

  return jsonb_build_object('round_id', v_round_id, 'sequence', v_seq, 'matches', v_count);
end;
$$;

revoke all on function append_round_as_scorer(uuid, jsonb) from public, anon;
grant execute on function append_round_as_scorer(uuid, jsonb) to authenticated;
