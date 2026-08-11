import { supabase } from "./client";

/**
 * The few extras the shareable recap card needs that the final-summary screen
 * doesn't already hold: the club name, the session's end date, and the podium
 * players' profile pictures.
 *
 * Everything here degrades quietly — a missing club, an unlinked guest or a
 * blocked profile read simply produces a card without that element rather than
 * failing the share.
 */
export interface RecapExtras {
  clubName: string | null;
  /** ISO date to print on the card: ended_at, else created_at, else now. */
  date: string;
  /** playerId → avatar URL, for players linked to an account with a picture. */
  avatarByPlayerId: Map<string, string>;
}

export async function getRecapExtras(sessionId: string, playerIds: string[]): Promise<RecapExtras> {
  const empty: RecapExtras = { clubName: null, date: new Date().toISOString(), avatarByPlayerId: new Map() };

  const { data: session, error } = await supabase
    .from("sessions")
    .select("club_id, ended_at, created_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !session) return empty;

  const date = session.ended_at ?? session.created_at ?? new Date().toISOString();

  // Club name — the host may not be able to read the club row if they've since
  // left it, in which case the card just omits the club line.
  let clubName: string | null = null;
  if (session.club_id) {
    const { data: club } = await supabase.from("clubs").select("name").eq("id", session.club_id).maybeSingle();
    clubName = club?.name ?? null;
  }

  // Avatars for the podium only. subjectIds are player ids for individual
  // formats; for Fixed Partner they're pair ids and simply won't match, so the
  // card falls back to initials — which is correct for a pair anyway.
  const avatarByPlayerId = new Map<string, string>();
  if (playerIds.length > 0) {
    const { data: players } = await supabase
      .from("players")
      .select("id, linked_user_id")
      .in("id", playerIds);
    const linked = (players ?? []).filter((p) => !!p.linked_user_id);
    const userIds = [...new Set(linked.map((p) => p.linked_user_id as string))];
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, avatar_url").in("id", userIds);
      const avatarByUser = new Map((profiles ?? []).map((p) => [p.id, p.avatar_url as string | null]));
      for (const p of linked) {
        const url = avatarByUser.get(p.linked_user_id as string);
        if (url) avatarByPlayerId.set(p.id, url);
      }
    }
  }

  return { clubName, date, avatarByPlayerId };
}
