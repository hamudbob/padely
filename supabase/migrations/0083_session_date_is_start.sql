-- ---------------------------------------------------------------------
-- 0083_session_date_is_start.sql
--
-- A night is dated by when it STARTED (Hamud, 7 Nov 2026). Run AFTER 0082.
--
-- session_results.session_date was the moment the session ended. A Monday
-- night that ended at 01:09 counted as Tuesday: Champions showed the wrong
-- day, and a night ending after midnight on the last day of a month fell
-- into the next season. Every other screen (profile, history) already uses
-- the start.
--
-- 1. apply_session_results now dates a night by its start.
-- 2. Every league row already written is re-dated the same way. Only nights
--    that crossed midnight change, and only by that one day; a night that
--    crossed into a new month moves back to the month it was played in.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------

create or replace function apply_session_results(p_session_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_club    uuid;
  v_date    timestamptz;
  v_applied boolean;
  r jsonb;
begin
  select status, club_id, coalesce(started_at, ended_at, now()), coalesce(results_applied, false)
    into v_status, v_club, v_date, v_applied
    from sessions where id = p_session_id;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if not (is_session_host(p_session_id) or is_app_admin()) then
    raise exception 'Only the host can record results for this session.' using errcode = 'P0001';
  end if;
  if v_status <> 'ended' then
    raise exception 'Results are recorded only once a session has ended.' using errcode = 'P0001';
  end if;
  if v_applied then return; end if;

  delete from session_results where session_id = p_session_id;
  if v_club is null then
    update sessions set results_applied = true where id = p_session_id;
    return;
  end if;

  for r in select value from jsonb_array_elements(p_rows) as value loop
    insert into session_results (
      session_id, club_id, user_id, session_date, rank, field_size, player_count,
      placement_points, podium_bonus, wins, losses, draws, scored_points, perf_adj
    ) values (
      p_session_id, v_club, (r->>'user_id')::uuid, v_date,
      (r->>'rank')::int, (r->>'field_size')::int, (r->>'player_count')::int,
      (r->>'placement_points')::int, coalesce((r->>'podium_bonus')::int, 0),
      coalesce((r->>'wins')::int, 0), coalesce((r->>'losses')::int, 0),
      coalesce((r->>'draws')::int, 0), coalesce((r->>'scored_points')::numeric, 0),
      coalesce((r->>'perf_adj')::numeric, 0.5)
    )
    on conflict (session_id, user_id) do update set
      club_id = excluded.club_id, session_date = excluded.session_date, rank = excluded.rank,
      field_size = excluded.field_size, player_count = excluded.player_count,
      placement_points = excluded.placement_points, podium_bonus = excluded.podium_bonus,
      wins = excluded.wins, losses = excluded.losses, draws = excluded.draws,
      scored_points = excluded.scored_points, perf_adj = excluded.perf_adj;
  end loop;

  update sessions set results_applied = true where id = p_session_id;
end;
$$;

update session_results sr
   set session_date = s.started_at
  from sessions s
 where s.id = sr.session_id
   and s.started_at is not null
   and sr.session_date is distinct from s.started_at;
