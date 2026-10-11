-- ---------------------------------------------------------------------
-- 0071_co_host_safe_sync.sql
--
-- Makes co-hosts (0065) safe to switch on. Apply 0065 first.
--
-- ── The problem 0065 left open ─────────────────────────────────────────
--
-- The host's phone owns the session and pushes the whole graph up through
-- sync_session_state. A co-host writes straight to the server. Two things
-- in that push would have quietly undone the co-host:
--
--  1. ROUNDS. The push deletes any round past the highest sequence it
--     carries ("the device discarded the tail"). A round a co-host has just
--     appended is past that sequence on every push until the host's phone
--     pulls it -- so the next push deleted it, with its scores.
--
--  2. SCORES. The push upserts every match the phone holds. A host who
--     scored a match offline and reconnects after a co-host CORRECTED it
--     would put the old number back.
--
-- ── What this does ─────────────────────────────────────────────────────
--
--  * matches.scored_at / scored_by -- when a score was entered and by whom.
--    The phone stamps the time of the TAP (not of the push, which may be an
--    hour later), a co-host's score is stamped by the server. The later
--    entry wins, whichever side it came from.
--
--  * A push WITHOUT scored_at (an app version from before this migration)
--    may not overwrite a score a co-host entered. It may still write every
--    match a co-host has not touched, exactly as before.
--
--  * rounds.added_by_scorer -- a co-host's round is never deleted for being
--    absent from a push. The phone deletes one only by naming it in
--    discarded_round_ids. A phone that draws its OWN round at the same
--    sequence still replaces it: the host outranks the co-host, and the
--    alternative is the unique-violation abort 0064 exists to prevent.
--
--  * The two co-host RPCs now keep round status the way the phone does
--    (scored once every match is final; the new round in_progress).
--
--  * get_scorer_session returns every column the phone needs to merge a
--    co-host's work into its own copy, and my_scorer_sessions() tells a
--    co-host where they are needed.
--
-- Additive & safe to re-run.
-- ---------------------------------------------------------------------

alter table matches add column if not exists scored_at timestamptz;
alter table matches add column if not exists scored_by uuid references auth.users(id) on delete set null;
alter table rounds  add column if not exists added_by_scorer uuid references auth.users(id) on delete set null;

-- --- 1. Who wins a score ------------------------------------------------

-- TRUE when an incoming score (from the host's phone) should replace the one
-- stored. A missing score never wins (a silent payload must not erase one).
-- An older score never wins. A score with no timestamp -- an older app --
-- never wins over one somebody ELSE entered.
create or replace function incoming_score_wins(
  p_new_score int, p_new_at timestamptz,
  p_cur_at timestamptz, p_cur_by uuid, p_uid uuid
) returns boolean language sql immutable set search_path = public as $$
  select p_new_score is not null
     and case
           when p_new_at is not null then p_cur_at is null or p_new_at >= p_cur_at
           else p_cur_by is null or p_cur_by = p_uid
         end;
$$;

revoke all on function incoming_score_wins(int, timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;

-- --- 2. The host's push -------------------------------------------------

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
         -- the device discarded the tail -- but only a tail IT drew. A round a
         -- co-host appended is one this device may simply not have pulled
         -- yet; silence about it is not a decision to throw it away. The
         -- device says so explicitly, in discarded_round_ids, below.
         (s.sequence > v_max_seq and s.added_by_scorer is null)
         -- or this sequence was regenerated under a new id
         or exists (
           select 1 from jsonb_array_elements(p_payload -> 'rounds') as r
            where (r ->> 'sequence')::int = s.sequence
         )
       );
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
                       score_a, score_b, outcome, status, scored_at, scored_by)
  select (m ->> 'id')::uuid, (m ->> 'round_id')::uuid, (m ->> 'court_id')::uuid,
         nullif(m ->> 'pair_a_id', '')::uuid, nullif(m ->> 'pair_b_id', '')::uuid,
         nullif(m ->> 'score_a', '')::int, nullif(m ->> 'score_b', '')::int,
         nullif(m ->> 'outcome', ''),
         coalesce(m ->> 'status', 'not_started'),
         nullif(m ->> 'scored_at', '')::timestamptz,
         case when nullif(m ->> 'score_a', '') is not null then v_uid end
    from jsonb_array_elements(coalesce(p_payload -> 'matches', '[]'::jsonb)) as m
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
  'Since 0071: the later-entered score wins (scored_at), a co-host''s round is never deleted for being absent, only when listed in discarded_round_ids. Replicates a locally-owned live session, its settings and its exact lineups included, and returns code-joiners the device has not seen. Deletes superseded rounds BEFORE inserting (rounds is unique on session_id+sequence, so a leftover collides and aborts the whole push). Never touches a sequence the payload is silent about, and never overwrites a recorded score with a local null. Host only.';

-- --- 3. The co-host's view and writes (0065, extended) -----------------

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
      'status', v_session.status,
      'club_id', v_session.club_id,
      'started_at', v_session.started_at,
      'host_name', (select display_name from profiles where id = v_session.created_by),
      'is_host', v_session.created_by = auth.uid()
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
               'id', pl.id, 'display_name', pl.display_name, 'gender', pl.gender,
               'status', pl.status, 'team_side', pl.team_side,
               'preferred_side', pl.preferred_side,
               'matches_played', pl.matches_played, 'rests', pl.rests,
               'joined_at', pl.joined_at,
               'linked_user_id', pl.linked_user_id,
               'avatar_url', pr.avatar_url
             )), '[]'::jsonb)
      from players pl
      left join profiles pr on pr.id = pl.linked_user_id
      where pl.session_id = v_session.id
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
               'id', id, 'sequence', sequence, 'status', status,
               'generation_reason', generation_reason, 'seed_used', seed_used,
               'generated_at', generated_at, 'added_by_scorer', added_by_scorer
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
               'scored_at', m.scored_at,
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
         scored_at  = now(),
         scored_by  = v_uid,
         updated_at = now()
   where id = p_match_id;

  -- Round status the way the phone keeps it (setLocalMatchScore).
  update rounds r
     set status = case
                    when not exists (select 1 from matches m
                                      where m.round_id = r.id
                                        and m.status not in ('final', 'cancelled'))
                      then 'scored' else 'in_progress' end
   where r.id = v_match.round_id
     and r.status <> 'superseded';

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
  update rounds set status = 'scored'
   where session_id = p_session_id and sequence = v_seq - 1 and status <> 'superseded';

  -- added_by_scorer is what stops the host's next push deleting this round
  -- before the host's phone has pulled it (see sync_session_state above).
  insert into rounds (id, session_id, sequence, status, generation_reason, seed_used, generated_at, added_by_scorer)
  values (v_round_id, p_session_id, v_seq, 'in_progress',
          coalesce(nullif(trim(p_round ->> 'generation_reason'), ''), 'advanced by co-host'),
          coalesce((p_round ->> 'seed_used')::bigint, v_session.scheduling_seed),
          now(),
          case when v_session.created_by = v_uid then null else v_uid end);

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

-- --- 5. Where a co-host is needed ---------------------------------------

-- The live sessions the caller co-hosts, newest first. Only what a card on
-- the Play tab needs; the session itself comes from get_scorer_session.
create or replace function my_scorer_sessions()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'name', s.name,
           'status', s.status,
           'started_at', s.started_at,
           'host_name', pr.display_name,
           'club_name', c.name
         ) order by s.started_at desc nulls last), '[]'::jsonb)
    from session_scorers ss
    join sessions s on s.id = ss.session_id
    left join profiles pr on pr.id = s.created_by
    left join clubs c on c.id = s.club_id
   where ss.user_id = auth.uid()
     and s.status = 'live';
$$;

revoke all on function my_scorer_sessions() from public, anon;
grant execute on function my_scorer_sessions() to authenticated;
