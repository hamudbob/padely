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

export interface PublicProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  ratingGames: number;
  provisional: boolean;
  memberSince: string;
  teams: PublicTeam[];
}

export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc("get_public_profile", { p_user_id: userId });
  if (error) throw error;
  if (!data) return null;
  const d = data as {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    rating: number | null;
    rating_games: number | null;
    provisional: boolean | null;
    member_since: string;
    teams: { id: string; name: string; logo_url: string | null; role: "owner" | "admin" | "member" }[] | null;
  };
  return {
    id: d.id,
    displayName: d.display_name ?? "Player",
    avatarUrl: d.avatar_url,
    rating: Math.round(d.rating ?? 1500),
    ratingGames: d.rating_games ?? 0,
    provisional: !!d.provisional,
    memberSince: d.member_since,
    teams: (d.teams ?? []).map((t) => ({ id: t.id, name: t.name, logoUrl: t.logo_url, role: t.role })),
  };
}
