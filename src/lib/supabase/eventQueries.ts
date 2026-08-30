import { supabase } from "./client";
import { getProfiles } from "./profileQueries";

/**
 * Scheduled club sessions ("events") + RSVPs (0020). Admins schedule; any
 * member RSVPs in/maybe/out and reads everyone's responses. When it's time, an
 * admin starts the real session from the event (the create wizard is pre-filled
 * with the team + title via /create?club=&name=).
 */

/** "waitlist" is never something a person chooses — it is what "in" becomes on
 *  a full night, and what they are until a place opens. */
export type RsvpResponse = "in" | "maybe" | "out" | "waitlist";

export interface ClubEvent {
  id: string;
  clubId: string;
  title: string;
  scheduledAt: string;
  location: string | null;
  notes: string | null;
  status: "scheduled" | "cancelled";
  /** The four planning numbers, any of which may be unset on an older event. */
  courtCount: number | null;
  durationHours: number | null;
  maxPlayers: number | null;
  cost: string | null;
  myResponse: RsvpResponse | null;
  counts: { in: number; maybe: number; out: number; waitlist: number };
  goingNames: string[];
  maybeNames: string[];
  waitlistNames: string[];
  /** True once a session has been started from this event and is still live —
   * members can then watch/join it right from the club page. */
  isLive: boolean;
  /** The live session's public token + join code (present only when isLive). */
  liveToken: string | null;
  liveCode: string | null;
  /** Readable share path — padelier.id/e/pler-monday-sesh (0055). Null on an
   *  event whose title had no letters or digits to build one from, and on any
   *  event created before 0055 that the backfill couldn't name; the uuid link
   *  still works in both cases. */
  slug: string | null;
}

/**
 * The path this event should be shared as.
 *
 * The slug when there is one, the uuid when there isn't. One function so the
 * club card, the event page and anything added later can't drift apart and
 * start handing out two different links for the same night.
 */
export function eventPath(e: { id: string; slug?: string | null }): string {
  return `/e/${e.slug || e.id}`;
}

/**
 * The shorthand a host writes at the top of a group-chat invite: 2C3H12P —
 * two courts, three hours, twelve places.
 *
 * Only the parts that exist appear, so a night with no cap reads 2C3H and one
 * with nothing set contributes nothing at all rather than a stray separator.
 * Hours keep a half if there is one (1.5H) and lose a trailing .0 (3H).
 */
export function eventCode(e: {
  courtCount?: number | null;
  durationHours?: number | null;
  maxPlayers?: number | null;
}): string {
  const parts: string[] = [];
  if (e.courtCount) parts.push(`${e.courtCount}C`);
  if (e.durationHours) parts.push(`${Number(e.durationHours.toFixed(1)).toString()}H`);
  if (e.maxPlayers) parts.push(`${e.maxPlayers}P`);
  return parts.join("");
}

export interface NewEvent {
  title: string;
  scheduledAt: string; // ISO
  location?: string | null;
  notes?: string | null;
  /** The four planning numbers. All optional — an event with none of them is
   *  exactly what an event was before 0048. */
  courtCount?: number | null;
  durationHours?: number | null;
  maxPlayers?: number | null;
  cost?: string | null;
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
    p_court_count: input.courtCount ?? null,
    p_duration_hours: input.durationHours ?? null,
    p_max_players: input.maxPlayers ?? null,
    p_cost: input.cost?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface EventGoing {
  /** Null for a guest — they have no account to link the player row to. */
  userId: string | null;
  displayName: string;
  /** Only set for guests. A member's gender comes from their profile. */
  gender?: "M" | "F";
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

  // Guests come too. Leaving them out here is the failure mode that would make
  // the whole feature pointless: the RSVP page would say 12 going, and the
  // session started from it would seed 10 players.
  const { data: guestRows, error: guestError } = await supabase
    .from("club_event_guests")
    .select("id, display_name, gender")
    .eq("event_id", eventId)
    .eq("response", "in")
    .order("created_at", { ascending: true });
  if (guestError) throw guestError;
  const guests: EventGoing[] = (guestRows ?? []).map((g) => ({
    userId: null,
    displayName: g.display_name,
    gender: (g.gender as "M" | "F") ?? "M",
  }));

  if (ids.length === 0) return guests;
  const profiles = await getProfiles(ids);
  return [...ids.map((id) => ({ userId: id, displayName: profiles.get(id)?.displayName ?? "Player" })), ...guests];
}

/** Bring someone who isn't on the app. Counts toward the cap; joins the queue
 *  when the night is already full. */
export async function addEventGuest(
  eventId: string,
  name: string,
  gender: "M" | "F",
): Promise<{ id: string; name: string; response: "in" | "waitlist"; waitlisted: boolean }> {
  const { data, error } = await supabase.rpc("add_event_guest", {
    p_event_id: eventId,
    p_name: name,
    p_gender: gender,
  });
  if (error) throw error;
  return data as { id: string; name: string; response: "in" | "waitlist"; waitlisted: boolean };
}

/** Whoever brought them, or a club admin. Frees the place and promotes the
 *  next person waiting. */
export async function removeEventGuest(guestId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_event_guest", { p_guest_id: guestId });
  if (error) throw error;
}

/** Link a scheduled event to the session started from it — the Start button on
 *  the club's event card. Goes through the RPC (0052) rather than a table
 *  update so it also clears any OTHER event that was auto-attached to this
 *  session a moment earlier; one session belongs to one night. */
export async function linkEventSession(eventId: string, sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("link_event_session", { p_event_id: eventId, p_session_id: sessionId });
  if (error) throw new Error(error.message);
}

/** The safety net for every other way a club session gets started (0052).
 *
 *  The explicit link above only happens if the host used the event card's Start
 *  button. Start the same night from Play instead and the club page kept
 *  offering an RSVP form for a session already in play. This attaches the
 *  club's single scheduled event near this moment — and does nothing at all
 *  when there's more than one candidate, because attaching the wrong night's
 *  RSVPs to a real session is worse than the problem it fixes.
 *
 *  Returns the event it claimed, or null when it declined. Best-effort:
 *  a failure here must never make a successful session start look failed. */
export async function attachSessionToEvent(sessionId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("attach_session_to_event", { p_session_id: sessionId });
  if (error) return null;
  return (data as unknown as string | null) ?? null;
}

/** Upcoming scheduled sessions for a team, each with RSVP counts, who's coming,
 * and the caller's own response. Ordered soonest-first. */
export async function getClubEvents(clubId: string): Promise<ClubEvent[]> {
  const { data: userData } = await supabase.auth.getUser();
  const myId = userData.user?.id ?? null;

  const { data: events, error } = await supabase
    .from("club_events")
    .select(
      "id, club_id, title, scheduled_at, location, notes, status, session_id, created_by, created_at, court_count, duration_hours, max_players, cost, slug",
    )
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

  // Linked sessions (started from an event) — so we can show a live one as
  // joinable and drop finished/past ones from the upcoming list.
  const sessionIds = [...new Set(rows.map((e) => e.session_id).filter((s): s is string => !!s))];
  const sessionById = new Map<string, { status: string; public_token: string; join_code: string }>();
  if (sessionIds.length > 0) {
    const { data: sess } = await supabase.from("sessions").select("id, status, public_token, join_code").in("id", sessionIds);
    for (const s of sess ?? []) sessionById.set(s.id, { status: s.status, public_token: s.public_token, join_code: s.join_code });
  }

  const profiles = await getProfiles([...new Set((rsvps ?? []).map((r) => r.user_id))]);
  const nameOf = (uid: string) => profiles.get(uid)?.displayName ?? "Player";

  const byEvent = new Map<
    string,
    { in: string[]; maybe: string[]; out: string[]; waitlist: string[]; mine: RsvpResponse | null }
  >();
  for (const id of eventIds) byEvent.set(id, { in: [], maybe: [], out: [], waitlist: [], mine: null });
  for (const r of rsvps ?? []) {
    const rec = byEvent.get(r.event_id);
    if (!rec) continue;
    const resp = r.response as RsvpResponse;
    // A row with an unknown response would otherwise push onto undefined.
    if (resp in rec) rec[resp].push(nameOf(r.user_id));
    if (myId && r.user_id === myId) rec.mine = resp;
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();

  return rows
    .map((e) => {
      const rec = byEvent.get(e.id)!;
      const sess = e.session_id ? sessionById.get(e.session_id) : undefined;
      const isLive = sess?.status === "live";
      const sessionEnded = sess?.status === "ended";
      const scheduledMs = new Date(e.scheduled_at).getTime();
      // Keep it in the list if it's live now, or it hasn't finished and isn't a
      // past day. Drop ended sessions and yesterday-or-older events.
      const keep = isLive || (!sessionEnded && (Number.isNaN(scheduledMs) || scheduledMs >= todayMs));
      return {
        event: {
          id: e.id,
          clubId: e.club_id,
          title: e.title,
          scheduledAt: e.scheduled_at,
          location: e.location,
          notes: e.notes,
          status: e.status,
          courtCount: e.court_count ?? null,
          durationHours: e.duration_hours === null || e.duration_hours === undefined ? null : Number(e.duration_hours),
          maxPlayers: e.max_players ?? null,
          cost: e.cost ?? null,
          myResponse: rec.mine,
          counts: { in: rec.in.length, maybe: rec.maybe.length, out: rec.out.length, waitlist: rec.waitlist.length },
          goingNames: rec.in,
          maybeNames: rec.maybe,
          waitlistNames: rec.waitlist,
          isLive: !!isLive,
          liveToken: isLive ? sess?.public_token ?? null : null,
          liveCode: isLive ? sess?.join_code ?? null : null,
          slug: (e as { slug?: string | null }).slug ?? null,
        } as ClubEvent,
        keep,
        isLive: !!isLive,
        scheduledMs,
      };
    })
    .filter((x) => x.keep)
    // Live sessions float to the top, then soonest upcoming first.
    .sort((a, b) => (a.isLive === b.isLive ? a.scheduledMs - b.scheduledMs : a.isLive ? -1 : 1))
    .map((x) => x.event);
}

/** An attendee shown on the public event page — enough to render an avatar row
 * and link to their public profile (/u/<id>). */
/** A row in going/waitlist. The guest fields are absent for members. */
interface GuestAwareRow {
  id: string;
  name: string | null;
  avatar: string | null;
  is_guest?: boolean;
  guest_id?: string | null;
  invited_by?: string | null;
}

export interface EventAttendee {
  /** For a guest this is "guest:<uuid>" — deliberately not a bare uuid, so it
   *  can never be mistaken for a user id and passed to something expecting an
   *  account. Use `guestId` when you mean the guest row. */
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Someone a member is bringing who has no account (0056). */
  isGuest?: boolean;
  guestId?: string | null;
  /** The member who brought them — who may remove them again. */
  invitedBy?: string | null;
}

/** A guest as their own record, with the gender a Mix draw needs. */
export interface EventGuest {
  id: string;
  name: string;
  gender: "M" | "F";
  response: "in" | "waitlist";
  invitedBy: string | null;
  invitedByName: string | null;
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
  courtCount: number | null;
  durationHours: number | null;
  maxPlayers: number | null;
  cost: string | null;
  counts: { in: number; maybe: number; out: number; waitlist: number };
  goingNames: string[];
  /** RSVP "in" players, as tappable profiles. Alphabetical — it's a roster. */
  going: EventAttendee[];
  /** RSVP "maybe" players. */
  maybe: EventAttendee[];
  /** Who said no. */
  out: EventAttendee[];
  /** In the order they asked — this one is a queue, so the order IS the point. */
  waitlist: EventAttendee[];
  /** Everyone's guests, in and waiting, with the gender the create wizard
   *  needs to seed a Mix session. */
  guests: EventGuest[];
  myResponse: RsvpResponse | null;
  isMember: boolean;
  /** Club owner or admin: can promote and remove people. */
  isAdmin: boolean;
  /** The readable path this event answers to (0055), for the share button on
   *  the page itself. */
  slug: string | null;
  /** Set once a session has been started from this event. While it is live the
   *  page offers the scoreboard instead of an RSVP form — answering here would
   *  change nothing on court, and the server refuses it anyway (0052). */
  session: { id: string; status: string; publicToken: string | null; joinCode: string | null } | null;
}

/** Read-only shareable view of a scheduled session (0026) — works for anyone,
 * incl. logged-out visitors. Members get their own response + is_member so the
 * page can offer the RSVP control. */
/**
 * `ref` is a slug OR a uuid, and both work forever (0055). Every /e/ link
 * shared before slugs existed is a uuid, and those must keep resolving; a slug
 * must keep resolving after the session it belongs to has ended. The server
 * decides which shape it's holding — nothing here inspects the string.
 */
export async function getPublicEvent(ref: string): Promise<PublicEvent | null> {
  const { data, error } = await supabase.rpc("get_public_event_by_ref", { p_ref: ref });
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
    court_count: number | null;
    duration_hours: number | null;
    max_players: number | null;
    cost: string | null;
    counts: { in: number; maybe: number; out: number; waitlist: number };
    going_names: string[] | null;
    going: GuestAwareRow[] | null;
    maybe: { id: string; name: string | null; avatar: string | null }[] | null;
    out: { id: string; name: string | null; avatar: string | null }[] | null;
    waitlist: GuestAwareRow[] | null;
    guests:
      | { id: string; name: string; gender: "M" | "F"; response: "in" | "waitlist"; invited_by: string | null; invited_by_name: string | null }[]
      | null;
    my_response: RsvpResponse | null;
    is_member: boolean;
    is_admin: boolean;
    session: { id: string; status: string; public_token: string | null; join_code: string | null } | null;
    slug?: string | null;
  };
  const mapPeople = (rows: GuestAwareRow[] | null): EventAttendee[] =>
    (rows ?? []).map((r) => ({
      userId: r.id,
      displayName: r.name ?? "Player",
      avatarUrl: r.avatar,
      isGuest: !!r.is_guest,
      guestId: r.guest_id ?? null,
      invitedBy: r.invited_by ?? null,
    }));
  return {
    id: d.id,
    clubId: d.club_id,
    teamName: d.team_name,
    teamLogo: d.team_logo,
    title: d.title,
    scheduledAt: d.scheduled_at,
    location: d.location,
    status: d.status,
    courtCount: d.court_count ?? null,
    durationHours: d.duration_hours === null || d.duration_hours === undefined ? null : Number(d.duration_hours),
    maxPlayers: d.max_players ?? null,
    cost: d.cost ?? null,
    counts: { in: d.counts.in, maybe: d.counts.maybe, out: d.counts.out, waitlist: d.counts.waitlist ?? 0 },
    goingNames: d.going_names ?? [],
    going: mapPeople(d.going),
    maybe: mapPeople(d.maybe),
    out: mapPeople(d.out),
    waitlist: mapPeople(d.waitlist),
    guests: (d.guests ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      gender: g.gender,
      response: g.response,
      invitedBy: g.invited_by,
      invitedByName: g.invited_by_name,
    })),
    myResponse: d.my_response,
    isMember: d.is_member,
    isAdmin: !!d.is_admin,
    slug: d.slug ?? null,
    session: d.session
      ? {
          id: d.session.id,
          status: d.session.status,
          publicToken: d.session.public_token,
          joinCode: d.session.join_code,
        }
      : null,
  };
}

export interface RsvpResult {
  /** What you ACTUALLY are — asking for "in" on a full night returns "waitlist". */
  response: RsvpResponse;
  asked_for: RsvpResponse;
  /** True when you asked to be in and were queued instead. */
  waitlisted: boolean;
  /** Your place in the queue, 1-based. Null unless you're waitlisted. */
  position: number | null;
  in_count: number;
  promoted_user_id: string | null;
}

/**
 * Set (or change) the caller's RSVP.
 *
 * Goes through the set_event_rsvp RPC rather than writing the row directly,
 * because a capped event cannot be enforced from here: two phones counting
 * "11 in, room for one" at the same moment would both write themselves in.
 * The function takes a row lock on the event before counting. It also returns
 * what you actually got, which is not always what you asked for.
 */
export async function setRsvp(eventId: string, response: RsvpResponse): Promise<RsvpResult> {
  const { data, error } = await supabase.rpc("set_event_rsvp", {
    p_event_id: eventId,
    p_response: response,
  });
  if (error) throw new Error(error.message);
  return data as RsvpResult;
}

/** A club admin sets someone else's answer — promoting off the waiting list,
 *  or taking someone out who can't make it. May exceed the cap on purpose. */
export async function setMemberRsvp(
  eventId: string,
  userId: string,
  response: RsvpResponse,
): Promise<{ in_count: number; promoted_user_id: string | null }> {
  const { data, error } = await supabase.rpc("event_set_member_rsvp", {
    p_event_id: eventId,
    p_user_id: userId,
    p_response: response,
  });
  if (error) throw new Error(error.message);
  return data as { in_count: number; promoted_user_id: string | null };
}

/**
 * Admin edit of a scheduled session.
 *
 * Title, time and location are "leave it alone if null"; the four numbers are
 * set outright, so passing null genuinely clears one — "actually there's no
 * cap tonight" has to be expressible.
 */
export async function updateEventDetails(
  eventId: string,
  d: {
    title?: string | null;
    scheduledAt?: string | null;
    courtCount?: number | null;
    durationHours?: number | null;
    maxPlayers?: number | null;
    cost?: string | null;
    location?: string | null;
  },
): Promise<{ in_count: number; waitlist_count: number }> {
  const { data, error } = await supabase.rpc("update_club_event", {
    p_event_id: eventId,
    p_title: d.title?.trim() || null,
    p_scheduled_at: d.scheduledAt ?? null,
    p_court_count: d.courtCount ?? null,
    p_duration_hours: d.durationHours ?? null,
    p_max_players: d.maxPlayers ?? null,
    p_cost: d.cost?.trim() || null,
    p_location: d.location?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as { in_count: number; waitlist_count: number };
}

/** Cancel a scheduled event (admins only — enforced by RLS). */
export async function cancelEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from("club_events").update({ status: "cancelled" }).eq("id", eventId);
  if (error) throw new Error(error.message);
}
