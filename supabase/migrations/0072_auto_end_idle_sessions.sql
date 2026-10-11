-- ---------------------------------------------------------------------
-- 0072_auto_end_idle_sessions.sql
--
-- A night nobody ended ends itself.
--
-- Hosts forget. The session stays LIVE for days: it sits on the host's Play
-- tab as "Resume hosting", on every co-host's Play tab, on the club card,
-- and it is never rated and never reaches the league. So:
--
--  * sessions.last_activity_at -- when the server last heard anything about
--    the night: a push from the host's phone, a score, a round, a player.
--
--  * auto_end_idle_sessions() ends every live session idle for 12 hours.
--    ended_at is the moment it went quiet, not the moment the sweep ran, and
--    auto_ended records that nobody pressed the button. pg_cron runs it every
--    15 minutes; the host's phone also asks for ITS sessions on launch
--    (end_session_if_idle), so the rule holds even where cron is not enabled.
--
--  * A push can no longer make an ended session live again. Until now the
--    status simply followed the phone -- so a phone that had missed the end
--    would undo it on its next push.
--
--  * reopen_session() is the one way back: for the host or an admin. It
--    walks back the ratings the night applied (the same undo 0040 uses on
--    delete) and clears its league rows, so ending it again rates it again
--    from scratch -- never twice.
--
-- Ratings are still computed on the host's phone (0013), so an auto-ended
-- night is rated when the host next opens the app, which is also when the
-- phone learns it has ended.
--
-- Additive & safe to re-run. Apply after 0071.
-- ---------------------------------------------------------------------

alter table sessions add column if not exists last_activity_at timestamptz;
alter table sessions add column if not exists auto_ended boolean not null default false;
alter table sessions add column if not exists reopened_at timestamptz;

update sessions
   set last_activity_at = coalesce(updated_at, started_at, created_at)
 where last_activity_at is null;

create index if not exists sessions_live_activity_idx
  on sessions (last_activity_at) where status = 'live';

-- --- 1. What counts as activity ----------------------------------------

-- Anything that changes a match, a round or a player. Throttled to one write
-- a minute per session: a push upserts every match of the night, and thirty
-- identical updates of the same session row would be pure lock churn.
create or replace function touch_session_activity(p_session_id uuid)
returns void language sql security definer set search_path = public as $$
  update sessions
     set last_activity_at = now()
   where id = p_session_id
     and status = 'live'
     and (last_activity_at is null or last_activity_at < now() - interval '1 minute');
$$;
revoke all on function touch_session_activity(uuid) from public, anon, authenticated;

create or replace function trg_match_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_session_activity((select session_id from rounds where id = new.round_id));
  return null;
end;
$$;

create or replace function trg_session_child_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform touch_session_activity(new.session_id);
  return null;
end;
$$;

drop trigger if exists match_activity on matches;
create trigger match_activity after insert or update on matches
  for each row execute function trg_match_activity();

drop trigger if exists round_activity on rounds;
create trigger round_activity after insert on rounds
  for each row execute function trg_session_child_activity();

drop trigger if exists player_activity on players;
create trigger player_activity after insert or update on players
  for each row execute function trg_session_child_activity();

-- --- 2. The host's push: one-way status, and it counts as activity ------

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
  'Since 0072: never turns an ended session live again; records activity for the idle sweep. Since 0071: the later-entered score wins (scored_at), a co-host''s round is never deleted for being absent, only when listed in discarded_round_ids. Replicates a locally-owned live session, its settings and its exact lineups included, and returns code-joiners the device has not seen. Deletes superseded rounds BEFORE inserting (rounds is unique on session_id+sequence, so a leftover collides and aborts the whole push). Never touches a sequence the payload is silent about, and never overwrites a recorded score with a local null. Host only.';


-- --- 3. The sweep ------------------------------------------------------

create or replace function auto_end_idle_sessions(p_idle interval default interval '12 hours')
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update sessions
     set status     = 'ended',
         ended_at   = coalesce(last_activity_at, updated_at, started_at, created_at),
         auto_ended = true,
         updated_at = now()
   where status = 'live'
     and coalesce(last_activity_at, updated_at, started_at, created_at) < now() - p_idle;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
-- The scheduler runs as the database owner. Nobody else needs it.
revoke all on function auto_end_idle_sessions(interval) from public, anon, authenticated;

-- The same rule, for one session, asked for by its host's phone on launch.
-- Returns the session's status afterwards.
create or replace function end_session_if_idle(p_session_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  if not is_session_host(p_session_id) then
    raise exception 'Only the host can do that.' using errcode = 'P0001';
  end if;
  update sessions
     set status     = 'ended',
         ended_at   = coalesce(last_activity_at, updated_at, started_at, created_at),
         auto_ended = true,
         updated_at = now()
   where id = p_session_id
     and status = 'live'
     and coalesce(last_activity_at, updated_at, started_at, created_at) < now() - interval '12 hours';
  select status into v_status from sessions where id = p_session_id;
  return v_status;
end;
$$;
revoke all on function end_session_if_idle(uuid) from public, anon;
grant execute on function end_session_if_idle(uuid) to authenticated;

-- Every 15 minutes, where pg_cron is available. On Supabase it is: enable it
-- under Database -> Extensions if this notice says otherwise, then re-run.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available here (%). Sessions still end when the host opens the app.', sqlerrm;
    return;
  end;
  if exists (select 1 from cron.job where jobname = 'auto-end-idle-sessions') then
    perform cron.unschedule('auto-end-idle-sessions');
  end if;
  perform cron.schedule('auto-end-idle-sessions', '*/15 * * * *', 'select public.auto_end_idle_sessions()');
end;
$$;

-- --- 4. Reopening ------------------------------------------------------

-- The rating a session applied, walked back -- exactly as
-- delete_session_and_unrate (0040) does, without deleting anything else.
create or replace function unrate_session(p_session_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  h             record;
  v_is_last     boolean;
  v_later       numeric;
  v_later_games integer;
  v_n           integer := 0;
begin
  for h in select * from rating_history where session_id = p_session_id loop
    select not exists (
      select 1 from rating_history r2
       where r2.user_id = h.user_id
         and r2.session_id is distinct from h.session_id
         and (r2.created_at > h.created_at
              or (r2.created_at = h.created_at and r2.id > h.id))
    ) into v_is_last;

    if v_is_last and h.rating_before is not null then
      update profiles set
        rating            = h.rating_before,
        rating_deviation  = coalesce(h.rd_before, rating_deviation),
        rating_volatility = coalesce(h.vol_before, rating_volatility),
        rating_games      = coalesce(h.games_before, rating_games),
        updated_at        = now()
      where id = h.user_id;
    else
      v_later := coalesce(h.delta, 0);
      v_later_games := coalesce(h.games_after - h.games_before, 0);
      update profiles set
        rating       = greatest(100, rating - v_later),
        rating_games = greatest(0, rating_games - v_later_games),
        updated_at   = now()
      where id = h.user_id;
    end if;
    v_n := v_n + 1;
  end loop;

  delete from rating_history where session_id = p_session_id;
  return v_n;
end;
$$;
revoke all on function unrate_session(uuid) from public, anon, authenticated;

-- Host or admin. The night goes back to live with its scores intact; its
-- ratings and league rows are undone, so ending it again applies them once.
create or replace function reopen_session(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_status   text;
  v_is_admin boolean;
  v_unrated  integer;
  v_rows     integer;
begin
  if v_uid is null then
    raise exception 'Please sign in.' using errcode = 'P0001';
  end if;
  v_is_admin := is_app_admin();
  if not (is_session_host(p_session_id) or v_is_admin) then
    raise exception 'Only the host can reopen this session.' using errcode = 'P0001';
  end if;

  select status into v_status from sessions where id = p_session_id for update;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'ended' then
    raise exception 'This session is not ended.' using errcode = 'P0001';
  end if;

  v_unrated := unrate_session(p_session_id);
  delete from session_results where session_id = p_session_id;
  get diagnostics v_rows = row_count;

  update sessions
     set status           = 'live',
         ended_at         = null,
         auto_ended       = false,
         ratings_applied  = false,
         results_applied  = false,
         reopened_at      = now(),
         last_activity_at = now(),
         updated_at       = now()
   where id = p_session_id;

  if v_is_admin then
    insert into admin_actions (admin_id, action, target_type, target_id, detail)
    values (v_uid, 'reopen_session', 'session', p_session_id,
            jsonb_build_object('players_unrated', v_unrated, 'league_rows_removed', v_rows));
  end if;

  return jsonb_build_object('session_id', p_session_id, 'players_unrated', v_unrated, 'league_rows_removed', v_rows);
end;
$$;
revoke all on function reopen_session(uuid) from public, anon;
grant execute on function reopen_session(uuid) to authenticated;
