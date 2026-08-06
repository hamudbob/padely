-- ---------------------------------------------------------------------
-- 0030_champions_hall.sql  (club Champions Hall)
--
-- A derived hall-of-fame for a club — no new table. Everything is read from
-- session_results (0019), which already persists each ended club session's
-- per-member finishing rank, podium, points and date. Two views:
--   • Titles board — who has won the most sessions (rank = 1), with podium
--     finishes and sessions played, ranked by titles → podiums → best average.
--   • Recent champions — the latest ended sessions, each with its winner and
--     the top-3 podium.
-- Member-gated, same visibility as the rest of the club detail.
-- ---------------------------------------------------------------------

create or replace function get_club_champions(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_titles jsonb; v_recent jsonb;
begin
  if not is_club_member(p_club_id) then
    raise exception 'Only members can view the champions hall.' using errcode = 'P0001';
  end if;

  -- Titles board — only players who've finished 1st at least once.
  select coalesce(jsonb_agg(t order by t_titles desc, t_podiums desc, t_avg asc), '[]'::jsonb)
    into v_titles
    from (
      select
        jsonb_build_object(
          'user_id',  sr.user_id,
          'name',     pr.display_name,
          'avatar',   pr.avatar_url,
          'titles',   count(*) filter (where sr.rank = 1),
          'podiums',  count(*) filter (where sr.rank <= 3),
          'sessions', count(*)
        ) as t,
        count(*) filter (where sr.rank = 1) as t_titles,
        count(*) filter (where sr.rank <= 3) as t_podiums,
        avg(sr.rank) as t_avg
      from session_results sr
      join profiles pr on pr.id = sr.user_id
      where sr.club_id = p_club_id
      group by sr.user_id, pr.display_name, pr.avatar_url
      having count(*) filter (where sr.rank = 1) > 0
    ) x;

  -- Recent champions — latest ended sessions with a member winner + podium.
  select coalesce(jsonb_agg(r order by r_date desc), '[]'::jsonb)
    into v_recent
    from (
      select
        jsonb_build_object(
          'session_id',   s.id,
          'session_name', s.name,
          'session_date', champ.session_date,
          'field_size',   champ.field_size,
          'player_count', champ.player_count,
          'champion', jsonb_build_object(
            'user_id', champ.user_id,
            'name',    cpr.display_name,
            'avatar',  cpr.avatar_url,
            'points',  champ.scored_points
          ),
          'podium', (
            select coalesce(jsonb_agg(
                     jsonb_build_object('rank', p.rank, 'name', ppr.display_name, 'avatar', ppr.avatar_url)
                     order by p.rank
                   ), '[]'::jsonb)
              from session_results p
              join profiles ppr on ppr.id = p.user_id
             where p.session_id = s.id and p.rank <= 3
          )
        ) as r,
        champ.session_date as r_date
      from sessions s
      join lateral (
        select sr2.*
          from session_results sr2
         where sr2.session_id = s.id and sr2.rank = 1
         order by sr2.scored_points desc
         limit 1
      ) champ on true
      join profiles cpr on cpr.id = champ.user_id
      where s.club_id = p_club_id and s.status = 'ended'
      order by champ.session_date desc
      limit 20
    ) y;

  return jsonb_build_object('titles', v_titles, 'recent', v_recent);
end;
$$;

grant execute on function get_club_champions(uuid) to authenticated;
