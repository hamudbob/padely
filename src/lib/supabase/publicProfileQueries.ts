import { supabase } from "./client";

/**
 * Public, read-only player profile (0024). Backed by the get_public_profile
 * SECURITY DEFINER RPC, which returns ONLY non-private fields and is callable by
 * anyone (including logged-out visitors) — so a profile link is shareable.
 */

export interface PublicTeam {
  id: string;
  name: string;
  logoUrl: string | null;
  role: "owner" | "admin" | "member";
}

/** One outcome in the recent-form strip, newest first. */
export type FormResult = "W" | "L" | "D";

/** A single point on the rating sparkline, oldest → newest. */
export interface RatingPoint {
  rating: number;
  delta: number;
}

export interface PublicProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Short "about me" (0036). Null until they write one. */
  bio: string | null;
  rating: number;
  ratingGames: number;
  provisional: boolean;
  memberSince: string;
  teams: PublicTeam[];
  /** All-time finalized record across every session this player has played. */
  wins: number;
  losses: number;
  draws: number;
  /** Total decided matches — wins + losses + draws. */
  matches: number;
  /** Wins ÷ decided matches, 0..1 (0 when no matches). */
  winRate: number;
  /** Last up-to-5 outcomes, newest first. */
  form: FormResult[];
  /** Up-to-12 rating points, oldest → newest, for the trend sparkline. */
  ratingTrend: RatingPoint[];
  /** True when the viewer has blocked this player (0053). Never true the other
   *  way round: being blocked is not announced. When set, the name, photo and
   *  bio arrive already redacted from the server. */
  blockedByMe: boolean;
}

export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc("get_public_profile", { p_user_id: userId });
  if (error) throw error;
  if (!data) return null;
  const d = data as {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    bio?: string | null;
    rating: number | null;
    rating_games: number | null;
    provisional: boolean | null;
    member_since: string;
    teams: { id: string; name: string; logo_url: string | null; role: "owner" | "admin" | "member" }[] | null;
    wins: number | null;
    losses: number | null;
    draws: number | null;
    form: FormResult[] | null;
    rating_trend: { rating: number | null; delta: number | null }[] | null;
    blocked_by_me?: boolean;
  };
  const wins = d.wins ?? 0;
  const losses = d.losses ?? 0;
  const draws = d.draws ?? 0;
  const matches = wins + losses + draws;
  return {
    id: d.id,
    displayName: d.display_name ?? "Player",
    avatarUrl: d.avatar_url,
    // Undefined when 0036 hasn't been applied yet — treated the same as "no bio
    // written", so an unrun migration just hides the section instead of crashing.
    bio: d.bio ?? null,
    rating: Math.round(d.rating ?? 1500),
    ratingGames: d.rating_games ?? 0,
    provisional: !!d.provisional,
    memberSince: d.member_since,
    teams: (d.teams ?? []).map((t) => ({ id: t.id, name: t.name, logoUrl: t.logo_url, role: t.role })),
    wins,
    losses,
    draws,
    matches,
    winRate: matches > 0 ? wins / matches : 0,
    form: (d.form ?? []).filter((f): f is FormResult => f === "W" || f === "L" || f === "D"),
    ratingTrend: (d.rating_trend ?? []).map((p) => ({ rating: Math.round(p.rating ?? 1500), delta: Math.round(p.delta ?? 0) })),
    // Undefined before 0053 is applied — the same as "not blocked", so an
    // unrun migration hides the feature rather than crashing the page.
    blockedByMe: d.blocked_by_me === true,
  };
}
