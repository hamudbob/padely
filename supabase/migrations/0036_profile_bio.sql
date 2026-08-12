-- ---------------------------------------------------------------------
-- 0036_profile_bio.sql
--
-- A short "about me" on the profile, editable from the new Settings screen.
--
-- Capped at 280 characters in the DATABASE, not just the textarea. This is the
-- first free-text field in the app that strangers see on a public profile, and
-- a client-side maxLength is a layout suggestion, not a rule — anyone posting
-- straight to PostgREST could otherwise store a wall of text that wrecks every
-- profile card it appears on.
--
-- No XSS surface: React escapes all interpolated text and the app contains no
-- dangerouslySetInnerHTML / innerHTML sinks (confirmed in the security audit).
-- RLS is unchanged — profiles already allows "anyone signed in may read, you
-- may only write your own row", which is exactly right for a bio.
--
-- IMPORTANT: get_public_profile is reproduced below IN FULL, exactly as
-- 0027 defined it, with a single new 'bio' key added to the returned object.
-- `create or replace function` replaces the entire body — writing a shorter
-- convenience version here would have silently deleted the all-time record,
-- last-5 form and rating trend that the public profile page renders.
-- ---------------------------------------------------------------------

alter table profiles add column if not exists bio text;

alter table profiles drop constraint if exists profiles_bio_len;
alter table profiles add constraint profiles_bio_len
  check (bio is null or char_length(bio) <= 280);

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
    'bio',          v_profile.bio,          -- new in 0036
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
