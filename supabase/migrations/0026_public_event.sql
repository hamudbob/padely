-- ---------------------------------------------------------------------
-- 0026_public_event.sql
--
-- A shareable, read-only view of a scheduled club session ("event") so a link
-- like /e/<id> opens for ANYONE (incl. logged-out) with the details + RSVP
-- counts + who's in. Members additionally get their own current response and an
-- is_member flag so the page can offer the RSVP control (the write still goes
-- through club_event_rsvps' own membership-scoped policy — this RPC is read-only).
-- Exposes only non-private fields.
-- ---------------------------------------------------------------------

create or replace function get_public_event(p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ev club_events%rowtype; v_club clubs%rowtype; v_uid uuid := auth.uid();
begin
  select * into v_ev from club_events where id = p_event_id;
  if not found then return null; end if;
  select * into v_club from clubs where id = v_ev.club_id;

  return jsonb_build_object(
    'id', v_ev.id,
    'club_id', v_ev.club_id,
    'team_name', v_club.name,
    'team_logo', v_club.logo_url,
    'title', v_ev.title,
    'scheduled_at', v_ev.scheduled_at,
    'location', v_ev.location,
    'status', v_ev.status,
    'counts', jsonb_build_object(
      'in',    (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'in'),
      'maybe', (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'maybe'),
      'out',   (select count(*) from club_event_rsvps where event_id = p_event_id and response = 'out')
    ),
    'going_names', coalesce(
      (select jsonb_agg(p.display_name order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'in'),
      '[]'::jsonb),
    'my_response', (select response from club_event_rsvps where event_id = p_event_id and user_id = v_uid),
    'is_member', exists (select 1 from club_members where club_id = v_ev.club_id and user_id = v_uid)
  );
end;
$$;

grant execute on function get_public_event(uuid) to anon, authenticated;
