-- ---------------------------------------------------------------------
-- 0006_player_sessions.sql
-- Powers the dashboard's "Player" tab: the sessions a signed-in user has
-- JOINED (and been confirmed into), matched by the email on their confirmed
-- join requests. Matching by email means a guest's history also shows up the
-- moment they create an account with that same address.
--
-- RLS on join_requests is host-only, so a player can't read them directly —
-- this SECURITY DEFINER function is the safe, authenticated-only way in. It
-- only ever returns sessions tied to the CALLER's own email (from their JWT).
-- ---------------------------------------------------------------------
create or replace function get_player_sessions()
returns jsonb language sql stable security definer as $$
  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb)
  from (
    select distinct s.id, s.name, s.format, s.status, s.created_at, s.public_token
    from join_requests jr
    join sessions s on s.id = jr.session_id
    where jr.status = 'confirmed'
      and lower(jr.email) = lower(nullif(auth.jwt() ->> 'email', ''))
  ) t;
$$;

grant execute on function get_player_sessions() to authenticated;
