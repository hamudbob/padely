-- ---------------------------------------------------------------------
-- 0027_richer_profiles.sql  (richer public profile + club stats)
--
-- Two read-only enrichments, both aggregate-only (no per-match detail leaks):
--
-- 1. get_public_profile — now also returns the player's all-time record
--    (wins / losses / draws across every FINAL match they played, in any
--    session), their last-5 form, and a short rating trend for a sparkline.
--    Still only aggregates: no opponent names, no session detail, no scores.
--
-- 2. get_club_stats — a small member-gated summary for the club page's stats
--    strip: member count, ended-session count, and total games played.
--
-- A player's global identity is players.linked_user_id (-> profiles.id), so a
-- profile's whole match history is every match_participants row whose player is
-- linked to that user. "Win" = the player's side matches the match outcome.
-- ---------------------------------------------------------------------

create or replace function get_public_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_teams   jsonb;
  v_wins    int := 0;
  v_losses  int := 0;
  v_draws   int := 0;
  v_form    jsonb;
  v_trend   jsonb;
begin
  select * into v_profile from profiles where id = p_user_id;
  if not found then
    return null;
  end if;

  -- Teams (unchanged).
  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', c.id, 'name', c.name, 'logo_url', c.logo_url, 'role', cm.role)
             order by cm.joined_at
           ),
           '[]'::jsonb
         )
    into v_teams
    from club_members cm
    join clubs c on c.id = cm.club_id
   where cm.user_id = p_user_id;

  -- All-time record across every finalized, non-cancelled match this user
  -- played (via any session player row linked to them). A row is a win when the
  -- player's side won, a loss when the other side won, a draw when drawn.
  select
    count(*) filter (where (mp.side = 'A' and m.outcome = 'win_a')
                        or  (mp.side = 'B' and m.outcome = 'win_b')),
    count(*) filter (where (mp.side = 'A' and m.outcome = 'win_b')
                        or  (mp.side = 'B' and m.outcome = 'win_a')),
    count(*) filter (where m.outcome = 'draw')
    into v_wins, v_losses, v_draws
    from match_participants mp
    join players p on p.id = mp.player_id
    join matches m on m.id = mp.match_id
   where p.linked_user_id = p_user_id
     and m.status = 'final'
     and m.outcome in ('win_a', 'win_b', 'draw');

  -- Last-5 form, newest first: 'W' | 'L' | 'D'.
  select coalesce(jsonb_agg(res order by ord), '[]'::jsonb)
    into v_form
    from (
      select
        case
          when (mp.side = 'A' and m.outcome = 'win_a') or (mp.side = 'B' and m.outcome = 'win_b') then 'W'
          when m.outcome = 'draw' then 'D'
          else 'L'
        end as res,
        row_number() over (order by m.updated_at desc) as ord
      from match_participants mp
      join players p on p.id = mp.player_id
      join matches m on m.id = mp.match_id
     where p.linked_user_id = p_user_id
       and m.status = 'final'
       and m.outcome in ('win_a', 'win_b', 'draw')
     order by m.updated_at desc
     limit 5
    ) f;

  -- Rating trend, oldest -> newest (max 12 points) for a sparkline.
  select coalesce(jsonb_agg(jsonb_build_object('rating', rating, 'delta', delta) order by created_at), '[]'::jsonb)
    into v_trend
    from (
      select rating, delta, created_at
        from rating_history
       where user_id = p_user_id
       order by created_at desc
       limit 12
    ) h;

  return jsonb_build_object(
    'id',           v_profile.id,
    'display_name', v_profile.display_name,
    'avatar_url',   v_profile.avatar_url,
    'rating',       v_profile.rating,
    'rating_games', v_profile.rating_games,
    'provisional',  v_profile.rating_deviation > 110,
    'member_since', v_profile.created_at,
    'teams',        v_teams,
    'wins',         v_wins,
    'losses',       v_losses,
    'draws',        v_draws,
    'form',         v_form,
    'rating_trend', v_trend
  );
end;
$$;

grant execute on function get_public_profile(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- get_club_stats — member-gated summary for the club page stats strip.
-- Returns member count, count of ENDED sessions attributed to the club, and
-- total finalized games across those sessions. Membership is required (same
-- visibility as the rest of the club detail view).
-- ---------------------------------------------------------------------
create or replace function get_club_stats(p_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_members  int := 0;
  v_sessions int := 0;
  v_games    int := 0;
begin
  if not is_club_member(p_club_id) then
    raise exception 'Only members can view club stats.' using errcode = 'P0001';
  end if;

  select count(*) into v_members from club_members where club_id = p_club_id;

  select count(*) into v_sessions
    from sessions
   where club_id = p_club_id and status = 'ended';

  select count(*) into v_games
    from matches m
    join rounds r on r.id = m.round_id
    join sessions s on s.id = r.session_id
   where s.club_id = p_club_id
     and m.status = 'final'
     and m.outcome in ('win_a', 'win_b', 'draw');

  return jsonb_build_object('members', v_members, 'sessions', v_sessions, 'games', v_games);
end;
$$;

grant execute on function get_club_stats(uuid) to authenticated;
