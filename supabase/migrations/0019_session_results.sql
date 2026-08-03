-- ---------------------------------------------------------------------
-- 0019_session_results.sql  (Phase 3 — the club league feed)
--
-- Persists each CLUB session's final per-member standings so the club
-- league board can aggregate them WITHOUT every member needing to read the
-- host-only detail tables (players/matches/participants). Same trust +
-- shape as 0013's rating persistence: the host's client computes the
-- session's final standings (one source of truth — assembleStandings), then
-- submits the per-member rows through the SECURITY DEFINER
-- apply_session_results() RPC, which is the only thing allowed to write this
-- table.
--
-- Only MEMBERS (account-linked players) are stored — guests never appear on
-- a club board (decided design). Only sessions with a club_id produce rows.
--
-- Unlike ratings (which apply exactly once), results use REPLACE semantics:
-- every end recomputes and overwrites this session's rows, so re-ending a
-- reopened+extended session keeps the league correct. Cheap; owner-gated;
-- ended-only.
-- ---------------------------------------------------------------------

create table if not exists session_results (
  session_id       uuid not null references sessions(id) on delete cascade,
  club_id          uuid not null references clubs(id) on delete cascade,
  user_id          uuid not null references profiles(id) on delete cascade,
  session_date     timestamptz not null,
  rank             integer not null,
  field_size       integer not null,      -- ranked subjects in the session (players; pairs for Fixed Partner)
  player_count     integer not null,      -- turnout — compared to club.session_floor for qualification
  placement_points integer not null,      -- field_size - rank + 1
  podium_bonus     integer not null default 0, -- +3 / +2 / +1 for rank 1 / 2 / 3
  wins             integer not null default 0,
  losses           integer not null default 0,
  draws            integer not null default 0,
  scored_points    numeric not null default 0, -- compensated points total (the session's own standings number)
  primary key (session_id, user_id)
);
create index if not exists session_results_club_date_idx on session_results (club_id, session_date);
create index if not exists session_results_user_idx on session_results (user_id);

alter table session_results enable row level security;
-- Readable by the session's host OR any member of the club it belongs to —
-- that's the whole point (members see their club's league). NO client
-- insert/update/delete: rows are written ONLY by the SECURITY DEFINER RPC.
drop policy if exists session_results_read on session_results;
create policy session_results_read on session_results for select to authenticated
  using (is_club_member(club_id) or is_session_host(session_id));

-- Replace this session's league rows with the freshly-computed member standings.
-- p_rows: jsonb array of { user_id, rank, field_size, player_count,
--   placement_points, podium_bonus, wins, losses, draws, scored_points }.
-- club_id + session_date are read authoritatively from the session itself, never
-- trusted from the client. A non-club session (club_id null) simply clears any
-- rows and returns.
create or replace function apply_session_results(p_session_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_club    uuid;
  v_date    timestamptz;
  r jsonb;
begin
  select status, club_id, coalesce(ended_at, now())
    into v_status, v_club, v_date
    from sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;
  if not is_session_host(p_session_id) then
    raise exception 'Only the host can record results for this session.' using errcode = 'P0001';
  end if;
  if v_status <> 'ended' then
    raise exception 'Results are recorded only once a session has ended.' using errcode = 'P0001';
  end if;

  -- Always clear this session's rows first (replace semantics; also cleans up
  -- if a session was detached from its club).
  delete from session_results where session_id = p_session_id;
  if v_club is null then
    return; -- not a club session — nothing to record
  end if;

  for r in select value from jsonb_array_elements(p_rows) as value loop
    insert into session_results (
      session_id, club_id, user_id, session_date, rank, field_size, player_count,
      placement_points, podium_bonus, wins, losses, draws, scored_points
    ) values (
      p_session_id, v_club, (r->>'user_id')::uuid, v_date,
      (r->>'rank')::int, (r->>'field_size')::int, (r->>'player_count')::int,
      (r->>'placement_points')::int, coalesce((r->>'podium_bonus')::int, 0),
      coalesce((r->>'wins')::int, 0), coalesce((r->>'losses')::int, 0),
      coalesce((r->>'draws')::int, 0), coalesce((r->>'scored_points')::numeric, 0)
    )
    on conflict (session_id, user_id) do update set
      club_id = excluded.club_id,
      session_date = excluded.session_date,
      rank = excluded.rank,
      field_size = excluded.field_size,
      player_count = excluded.player_count,
      placement_points = excluded.placement_points,
      podium_bonus = excluded.podium_bonus,
      wins = excluded.wins,
      losses = excluded.losses,
      draws = excluded.draws,
      scored_points = excluded.scored_points;
  end loop;
end;
$$;

grant execute on function apply_session_results(uuid, jsonb) to authenticated;
