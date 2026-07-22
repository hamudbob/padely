-- ---------------------------------------------------------------------
-- 0007_watch_by_code.sql
-- Spectating by code: get_join_session now also returns the session's
-- public_token, so a watcher can resolve a 6-digit code straight to the
-- read-only live view (/live/:public_token) WITHOUT ever creating a player
-- join request. The player-join flow ignores the extra field.
-- ---------------------------------------------------------------------
create or replace function get_join_session(p_code text)
returns jsonb language plpgsql stable security definer as $$
declare
  v_session sessions%rowtype;
begin
  select * into v_session from sessions
    where join_code = p_code and status in ('draft','live');
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_session.id,
    'name', v_session.name,
    'format', v_session.format,
    'status', v_session.status,
    'public_token', v_session.public_token
  );
end;
$$;

grant execute on function get_join_session(text) to anon, authenticated;
