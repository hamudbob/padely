-- ---------------------------------------------------------------------
-- 0028_event_attendee_profiles.sql  (attendees with avatars on the event page)
--
-- Extends get_public_event (0026) so the shareable /e/<id> page can show WHO is
-- coming as tappable profiles — avatar + name that open /u/<id>. Adds two arrays,
-- `going` (RSVP "in") and `maybe` (RSVP "maybe"), each element { id, name, avatar }.
-- The plain `going_names` string array is kept for backward compatibility.
--
-- Exposure is consistent with the already-public player profile (0024): a
-- profile's id, display name, and avatar are all visible to anyone via /u/<id>,
-- so listing an event's attendees the same way leaks nothing new.
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
    'going', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url) order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'in'),
      '[]'::jsonb),
    'maybe', coalesce(
      (select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name, 'avatar', p.avatar_url) order by p.display_name)
         from club_event_rsvps r join profiles p on p.id = r.user_id
        where r.event_id = p_event_id and r.response = 'maybe'),
      '[]'::jsonb),
    'my_response', (select response from club_event_rsvps where event_id = p_event_id and user_id = v_uid),
    'is_member', exists (select 1 from club_members where club_id = v_ev.club_id and user_id = v_uid)
  );
end;
$$;

grant execute on function get_public_event(uuid) to anon, authenticated;
