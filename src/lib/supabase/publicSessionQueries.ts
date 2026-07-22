import { supabase } from "./client";

/**
 * Read-only wrapper around the `get_public_session(p_public_token)` RPC
 * (schema 0001_init.sql; granted to anon + authenticated, security definer).
 * ADDITIVE — this file calls an existing RPC only; it does not touch any
 * existing lib logic.
 *
 * Known gap (flagged for backend): the RPC returns NO matches and NO per-court
 * live scores, and its `standings` rows carry NO rank and NO player name — the
 * consumer must join `standings[].playerId → players[].displayName` and derive
 * rank client-side. See PublicLivePage for the derivation.
 */
export interface PublicSessionData {
  session: { name: string; format: string; scoringFormat: string; status: "draft" | "live" | "ended" };
  courts: { id: string; displayName: string; available: boolean }[];
  players: { id: string; displayName: string; status: string }[];
  standings: { playerId: string; totalPoints: number; wins: number; draws: number; losses: number; adjustmentTotal: number }[];
  rounds: { id: string; sequence: number; status: string }[];
}

export async function getPublicSession(publicToken: string): Promise<PublicSessionData | null> {
  const { data, error } = await supabase.rpc("get_public_session", { p_public_token: publicToken });
  if (error) throw error;
  if (!data) return null; // RPC returns null when the token matches nothing.
  // `data` is jsonb, typed `unknown` in database.types.ts. Shape it defensively
  // with a typed cast + snake→camel mapping to PublicSessionData; everything the
  // component consumes downstream is fully typed via this interface.
  const d = data as {
    session?: { name?: string; format?: string; scoring_format?: string; status?: PublicSessionData["session"]["status"] };
    courts?: { id: string; display_name: string; available: boolean }[];
    players?: { id: string; display_name: string; status: string }[];
    standings?: { player_id: string; total_points: number; wins: number; draws: number; losses: number; adjustment_total: number }[];
    rounds?: { id: string; sequence: number; status: string }[];
  };
  return {
    session: {
      name: d.session?.name ?? "",
      format: d.session?.format ?? "",
      scoringFormat: d.session?.scoring_format ?? "",
      status: d.session?.status ?? "live",
    },
    courts: (d.courts ?? []).map((c) => ({ id: c.id, displayName: c.display_name, available: c.available })),
    players: (d.players ?? []).map((p) => ({ id: p.id, displayName: p.display_name, status: p.status })),
    standings: (d.standings ?? []).map((s) => ({
      playerId: s.player_id,
      totalPoints: s.total_points,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      adjustmentTotal: s.adjustment_total,
    })),
    rounds: (d.rounds ?? []).map((r) => ({ id: r.id, sequence: r.sequence, status: r.status })),
  };
}
