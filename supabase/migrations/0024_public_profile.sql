-- ---------------------------------------------------------------------
-- 0024_public_profile.sql  (public player profile)
--
-- A shareable, read-only player profile — visible to ANYONE (incl. logged-out
-- visitors), like the public session view. Exposes ONLY non-private fields via
-- a SECURITY DEFINER RPC, so we never widen a table's RLS:
--   display name, avatar, global rating (+ provisional flag + games played),
--   member-since, and the teams the player belongs to (name/logo/role).
-- Deliberately NOT exposed: email, join codes, session detail, match history.
-- ---------------------------------------------------------------------

create or replace function get_public_profile(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_teams jsonb;
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

  return jsonb_build_object(
    'id',           v_profile.id,
    'display_name', v_profile.display_name,
    'avatar_url',   v_profile.avatar_url,
    'rating',       v_profile.rating,
    'rating_games', v_profile.rating_games,
    -- Provisional while the rating is still uncertain (RD above the 110 floor).
    'provisional',  v_profile.rating_deviation > 110,
    'member_since', v_profile.created_at,
    'teams',        v_teams
  );
end;
$$;

grant execute on function get_public_profile(uuid) to anon, authenticated;
