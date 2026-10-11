import { supabase } from "./client";
import { getProfiles } from "./profileQueries";
import { getLocalSession } from "../offline/localSession";

/**
 * Who is in a session, as PEOPLE: which spots belong to an account, whose
 * face to show, and — for a club session — who is actually in the club.
 *
 * Two screens read this and they must agree: the Standings tab (a face, or
 * "no account") and the end-of-session check (who hasn't joined yet). The
 * second exists because a spot with no account gets no rating, no league row
 * and no place in that person's history, and the host only finds out days
 * later; a linked player who isn't a club member gets a rating but no league
 * row. Both were silent until now.
 *
 * Source: the SERVER when it can be reached, because accounts are linked
 * there (claims, admin linking). This phone's copy is the fallback for a
 * session that has never uploaded or a court with no signal — where club
 * membership is simply unknown (`clubMemberIds: null`), never guessed.
 */
export interface SessionPerson {
  playerId: string;
  name: string;
  userId: string | null;
  avatarUrl: string | null;
  status: string;
}

export interface SessionPeople {
  clubId: string | null;
  byPlayer: Map<string, SessionPerson>;
  /** Pair id -> its two player ids (Fixed Partner standings rank pairs). */
  pairPlayers: Map<string, [string, string]>;
  /** Members of the session's club; null when there is no club or it is unknown. */
  clubMemberIds: Set<string> | null;
}

type Row = { id: string; display_name: string; linked_user_id: string | null; status: string };
type PairRow = { id: string; player_a_id: string; player_b_id: string };

export async function getSessionPeople(sessionId: string): Promise<SessionPeople> {
  let players: Row[] | null = null;
  let pairs: PairRow[] = [];
  let clubId: string | null = null;

  const online = typeof navigator === "undefined" || !("onLine" in navigator) || navigator.onLine;
  if (online) {
    try {
      const [p, pr, s] = await Promise.all([
        supabase.from("players").select("id, display_name, linked_user_id, status").eq("session_id", sessionId),
        supabase.from("pairs").select("id, player_a_id, player_b_id").eq("session_id", sessionId),
        supabase.from("sessions").select("club_id").eq("id", sessionId).maybeSingle(),
      ]);
      if (!p.error && (p.data ?? []).length > 0) {
        players = p.data as Row[];
        pairs = (pr.data ?? []) as PairRow[];
        clubId = (s.data?.club_id as string | null) ?? null;
      }
    } catch {
      /* fall through to this device's copy */
    }
  }

  if (!players) {
    const local = getLocalSession(sessionId);
    players = (local?.players ?? []).map((p) => ({
      id: p.id,
      display_name: p.display_name,
      linked_user_id: p.linked_user_id,
      status: p.status,
    }));
    pairs = (local?.pairs ?? []).map((p) => ({ id: p.id, player_a_id: p.player_a_id, player_b_id: p.player_b_id }));
    clubId = local?.session.club_id ?? null;
  }

  const userIds = [...new Set(players.map((p) => p.linked_user_id).filter((u): u is string => !!u))];
  let avatars = new Map<string, string | null>();
  if (online && userIds.length > 0) {
    try {
      const profiles = await getProfiles(userIds);
      avatars = new Map([...profiles].map(([id, prof]) => [id, prof.avatarUrl ?? null]));
    } catch {
      /* faces are a nicety; initials still render */
    }
  }

  let clubMemberIds: Set<string> | null = null;
  if (online && clubId) {
    const { data, error } = await supabase.from("club_members").select("user_id").eq("club_id", clubId);
    if (!error) clubMemberIds = new Set((data ?? []).map((m) => m.user_id as string));
  }

  const byPlayer = new Map<string, SessionPerson>();
  for (const p of players) {
    byPlayer.set(p.id, {
      playerId: p.id,
      name: p.display_name,
      userId: p.linked_user_id,
      avatarUrl: p.linked_user_id ? avatars.get(p.linked_user_id) ?? null : null,
      status: p.status,
    });
  }
  const pairPlayers = new Map<string, [string, string]>(pairs.map((p) => [p.id, [p.player_a_id, p.player_b_id]]));
  return { clubId, byPlayer, pairPlayers, clubMemberIds };
}

/** Spots that will get no rating, no league row and no history: no account. */
export function unlinkedPlayers(people: SessionPeople): SessionPerson[] {
  return [...people.byPlayer.values()]
    .filter((p) => !p.userId && p.status !== "left")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Linked, but not in the club: rated, yet missing from the league table. */
export function nonMembers(people: SessionPeople): SessionPerson[] {
  if (!people.clubMemberIds) return [];
  const members = people.clubMemberIds;
  return [...people.byPlayer.values()]
    .filter((p) => !!p.userId && !members.has(p.userId) && p.status !== "left")
    .sort((a, b) => a.name.localeCompare(b.name));
}
