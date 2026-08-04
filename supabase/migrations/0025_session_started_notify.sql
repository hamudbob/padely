-- ---------------------------------------------------------------------
-- 0025_session_started_notify.sql
--
-- Notify a club's members when the host starts a team session (goes live), so
-- they can come play or watch. Complements create_club_event (0022), which
-- already notifies when a session is SCHEDULED. Host-gated; club sessions only.
-- ---------------------------------------------------------------------

create or replace function notify_club_session_started(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_club uuid; v_name text; v_token text; v_host uuid;
begin
  select club_id, name, public_token, created_by
    into v_club, v_name, v_token, v_host
    from sessions where id = p_session_id;
  if not found or v_club is null then return; end if;
  if not is_session_host(p_session_id) then return; end if;

  insert into notifications (user_id, type, title, body, data)
  select cm.user_id, 'session_started', 'Session started',
         v_name || ' is live now',
         jsonb_build_object('club_id', v_club, 'session_id', p_session_id, 'public_token', v_token)
  from club_members cm
  where cm.club_id = v_club and cm.user_id <> v_host;
end;
$$;

grant execute on function notify_club_session_started(uuid) to authenticated;
