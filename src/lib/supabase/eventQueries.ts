import { supabase } from "./client";
import { getProfiles } from "./profileQueries";

/**
 * Scheduled club sessions ("events") + RSVPs (0020). Admins schedule; any
 * member RSVPs in/maybe/out and reads everyone's responses. When it's time, an
 * admin starts the real session from the event (the create wizard is pre-filled
 * with the team + title via /create?club=&name=).
 */

export type RsvpResponse = "in" | "maybe" | "out";

export interface ClubEvent {
  id: string;
  clubId: string;
  title: string;
  scheduledAt: string;
  location: string | null;
  notes: string | null;
  status: "scheduled" | "cancelled";
  myResponse: RsvpResponse | null;
  counts: { in: number; maybe: number; out: number };
  goingNames: string[];
  maybeNames: string[];
}

export interface NewEvent {
  title: string;
  scheduledAt: string; // ISO
  location?: string | null;
  notes?: string | null;
}

/** Schedule a session for a team (admins only). Goes through create_club_event
 * (0022) which also notifies every member. Returns the new event id. */
export async function createEvent(clubId: string, input: NewEvent): Promise<string> {
  const { data, error } = await supabase.rpc("create_club_event", {
    p_club_id: clubId,
    p_title: input.title.trim(),
    p_scheduled_at: input.scheduledAt,
    p_location: input.location?.trim() || null,
    p_notes: input.notes?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface EventGoing {
  userId: string;
  displayName: string;
}

/** Members who RSVP'd "in" to an event — used to pre-seed the roster when the
 * host starts the real session from it (audit #16). */
export async function getEventGoing(eventId: string): Promise<EventGoing[]> {
  const { data, error } = await supabase
    .from("club_event_rsvps")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("response", "in");
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];
  const profiles = await getProfiles(ids);
  return ids.map((id) => ({ userId: id, displayName: profiles.get(id)?.displayName ?? "Player" }));
}

/** Link a scheduled event to the session that was started from it (admins only,
 * via RLS). Best-effort — never blocks the session start. */
export async function linkEventSession(eventId: string, sessionId: string): Promise<void> {
  const { error } = await supabase.from("club_events").update({ session_id: sessionId }).eq("id", eventId);
  if (error) throw new Error(error.message);
}

/** Upcoming scheduled sessions for a team, each with RSVP counts, who's coming,
 * and the caller's own response. Ordered soonest-first. */
export async function getClubEvents(clubId: string): Promise<ClubEvent[]> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id ?? null;

  const { data: events, error } = await supabase
    .from("club_events")
    .select("id, club_id, title, scheduled_at, location, notes, status, session_id, created_by, created_at")
    .eq("club_id", clubId)
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  const rows = events ?? [];
  if (rows.length === 0) return [];

  const eventIds = rows.map((e) => e.id);
  const { data: rsvps, error: rsvpError } = await supabase
    .from("club_event_rsvps")
    .select("event_id, user_id, response")
    .in("event_id", eventIds);
  if (rsvpError) throw rsvpError;

  const profiles = await getProfiles([...new Set((rsvps ?? []).map((r) => r.user_id))]);
  const nameOf = (uid: string) => profiles.get(uid)?.displayName ?? "Player";

  const byEvent = new Map<string, { in: string[]; maybe: string[]; out: string[]; mine: RsvpResponse | null }>();
  for (const id of eventIds) byEvent.set(id, { in: [], maybe: [], out: [], mine: null });
  for (const r of rsvps ?? []) {
    const rec = byEvent.get(r.event_id);
    if (!rec) continue;
    const resp = r.response as RsvpResponse;
    rec[resp].push(nameOf(r.user_id));
    if (myId && r.user_id === myId) rec.mine = resp;
  }

  return rows.map((e) => {
    const rec = byEvent.get(e.id)!;
    return {
      id: e.id,
      clubId: e.club_id,
      title: e.title,
      scheduledAt: e.scheduled_at,
      location: e.location,
      notes: e.notes,
      status: e.status,
      myResponse: rec.mine,
      counts: { in: rec.in.length, maybe: rec.maybe.length, out: rec.out.length },
      goingNames: rec.in,
      maybeNames: rec.maybe,
    };
  });
}

export interface PublicEvent {
  id: string;
  clubId: string;
  teamName: string;
  teamLogo: string | null;
  title: string;
  scheduledAt: string;
  location: string | null;
  status: "scheduled" | "cancelled";
  counts: { in: number; maybe: number; out: number };
  goingNames: string[];
  myResponse: RsvpResponse | null;
  isMember: boolean;
}

/** Read-only shareable view of a scheduled session (0026) — works for anyone,
 * incl. logged-out visitors. Members get their own response + is_member so the
 * page can offer the RSVP control. */
export async function getPublicEvent(eventId: string): Promise<PublicEvent | null> {
  const { data, error } = await supabase.rpc("get_public_event", { p_event_id: eventId });
  if (error) throw error;
  if (!data) return null;
  const d = data as {
    id: string;
    club_id: string;
    team_name: string;
    team_logo: string | null;
    title: string;
    scheduled_at: string;
    location: string | null;
    status: "scheduled" | "cancelled";
    counts: { in: number; maybe: number; out: number };
    going_names: string[] | null;
    my_response: RsvpResponse | null;
    is_member: boolean;
  };
  return {
    id: d.id,
    clubId: d.club_id,
    teamName: d.team_name,
    teamLogo: d.team_logo,
    title: d.title,
    scheduledAt: d.scheduled_at,
    location: d.location,
    status: d.status,
    counts: d.counts,
    goingNames: d.going_names ?? [],
    myResponse: d.my_response,
    isMember: d.is_member,
  };
}

/** Set (or change) the caller's RSVP for an event. */
export async function setRsvp(eventId: string, response: RsvpResponse): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error("Please log in again.");
  const { error } = await supabase
    .from("club_event_rsvps")
    .upsert(
      { event_id: eventId, user_id: userData.user.id, response, responded_at: new Date().toISOString() },
      { onConflict: "event_id,user_id" },
    );
  if (error) throw new Error(error.message);
}

/** Cancel a scheduled event (admins only — enforced by RLS). */
export async function cancelEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from("club_events").update({ status: "cancelled" }).eq("id", eventId);
  if (error) throw new Error(error.message);
}
