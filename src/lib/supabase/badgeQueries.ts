import { supabase } from "./client";
import { BadgesData } from "../badges/model";

/**
 * Badges (0087). The server works out who has earned what; the app only reads
 * it. Before 0087 is on the database these return nothing rather than an
 * error, so profiles keep working.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcAny = (fn: string, args: Record<string, unknown> = {}) => (supabase as any).rpc(fn, args);

const missing = (msg: string | undefined) => !!msg && /does not exist|Could not find the function/i.test(msg);

type Raw = {
  earned?: { club_id: string | null; badge: string; level: number; earned_at: string; session_id: string | null; detail: Record<string, unknown> | null }[];
  progress?: { club_id: string | null; badge: string; value: number | string; detail: Record<string, unknown> | null }[];
  clubs?: { id: string; name: string; logo_url: string | null; owner: boolean }[];
  elite_seen?: boolean;
} | null;

export function badgesFromRaw(raw: Raw): BadgesData | null {
  if (!raw) return null;
  return {
    earned: (raw.earned ?? []).map((e) => ({
      clubId: e.club_id,
      badge: e.badge,
      level: Number(e.level),
      earnedAt: e.earned_at,
      sessionId: e.session_id,
      detail: e.detail,
    })),
    progress: (raw.progress ?? []).map((p) => ({ clubId: p.club_id, badge: p.badge, value: Number(p.value), detail: p.detail })),
    clubs: (raw.clubs ?? []).map((c) => ({ id: c.id, name: c.name, logoUrl: c.logo_url, owner: !!c.owner })),
    eliteSeen: !!raw.elite_seen,
  };
}

/** Anyone's badges (public, like the profile). Null: no such profile. */
export async function getBadges(userId: string): Promise<BadgesData | null> {
  const { data, error } = await rpcAny("get_badges", { p_user: userId });
  if (error) {
    if (missing(error.message)) return null;
    throw new Error(error.message);
  }
  return badgesFromRaw(data as Raw);
}

/** Works out the signed-in player's badges again (after their own night), so
 *  the results screen doesn't wait for the nightly run. Returns how many are new. */
export async function refreshMyBadges(): Promise<number> {
  const { data, error } = await rpcAny("refresh_my_badges");
  if (error) {
    if (missing(error.message)) return 0;
    throw new Error(error.message);
  }
  return Number(data ?? 0);
}
