-- ---------------------------------------------------------------------
-- 0070_admin_reset_session_results.sql
--
-- "Re-run finalize" could not fix a session whose league rows were wrong.
--
-- apply_session_results opens with `if results_applied then return`, so once
-- a session has been finalized, running it again does nothing at all — and
-- says nothing. On 24 Sep that meant five players linked after the night
-- could not be added to the league from the admin console; the only way was
-- clearing results_applied by hand in the SQL editor.
--
-- This is that, as a button: admin only, ended sessions only, logged.
-- It removes the session's league rows and clears the latch; the admin
-- screen then calls apply_session_results straight after, which rebuilds
-- every row from the current roster and club membership.
--
-- Ratings are deliberately NOT touched. Re-applying ratings would count the
-- night twice; a player linked late gets theirs from "Credit rating" (0047).
-- ---------------------------------------------------------------------

create or replace function admin_reset_session_results(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status  text;
  v_removed integer;
begin
  perform admin_guard();

  select status into v_status from sessions where id = p_session_id;
  if not found then raise exception 'Session not found.' using errcode = 'P0002'; end if;
  if v_status <> 'ended' then
    raise exception 'Only an ended session has league rows to rebuild.' using errcode = 'P0001';
  end if;

  delete from session_results where session_id = p_session_id;
  get diagnostics v_removed = row_count;

  update sessions set results_applied = false where id = p_session_id;

  insert into admin_actions (admin_id, action, target_type, target_id, detail)
  values (auth.uid(), 'reset_session_results', 'session', p_session_id,
          jsonb_build_object('rows_removed', v_removed));

  return jsonb_build_object('session_id', p_session_id, 'rows_removed', v_removed);
end;
$$;

revoke all on function admin_reset_session_results(uuid) from public, anon;
grant execute on function admin_reset_session_results(uuid) to authenticated;
