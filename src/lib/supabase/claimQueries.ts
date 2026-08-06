import { supabase } from "./client";

/**
 * Late-joiner "claim your spot" (0029). A signed-in player claims an existing
 * manual placeholder in a running session; the host accepts, which links their
 * account to that player row (and renames it to their real name). All writes go
 * through SECURITY DEFINER RPCs — the client never touches players.linked_user_id.
 */

export interface ClaimTarget {
  id: string;
  name: string;
}

/** Still-unclaimed, active names for the session behind this public token. */
export async function getClaimablePlayers(publicToken: string): Promise<ClaimTarget[]> {
  const { data, error } = await supabase.rpc("get_claimable_players", { p_public_token: publicToken });
  if (error) throw error;
  const rows = (data ?? []) as { id: string; name: string | null }[];
  return rows.map((r) => ({ id: r.id, name: r.name ?? "Player" }));
}

/** Request to claim a spot. Throws with a friendly message if it's taken/invalid. */
export async function requestPlayerClaim(playerId: string): Promise<void> {
  const { error } = await supabase.rpc("request_player_claim", { p_player_id: playerId });
  if (error) throw new Error(error.message);
}

export type ClaimStatus = "pending" | "approved" | "rejected" | "joined";

export interface MyClaim {
  status: ClaimStatus;
  playerName: string | null;
}

/** The caller's own claim state for a session (null if they've never claimed). */
export async function getMySessionClaim(publicToken: string): Promise<MyClaim | null> {
  const { data, error } = await supabase.rpc("get_my_session_claim", { p_public_token: publicToken });
  if (error) throw error;
  if (!data) return null;
  const d = data as { status: ClaimStatus; player_name: string | null };
  return { status: d.status, playerName: d.player_name };
}

export interface PendingClaim {
  id: string;
  playerId: string;
  playerName: string;
  claimantId: string;
  claimantName: string;
  claimantAvatar: string | null;
}

/** Host: pending claims awaiting a decision, newest last. */
export async function getPendingClaims(sessionId: string): Promise<PendingClaim[]> {
  const { data, error } = await supabase.rpc("get_pending_claims", { p_session_id: sessionId });
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    player_id: string;
    player_name: string | null;
    claimant_id: string;
    claimant_name: string | null;
    claimant_avatar: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    playerName: r.player_name ?? "Player",
    claimantId: r.claimant_id,
    claimantName: r.claimant_name ?? "Player",
    claimantAvatar: r.claimant_avatar,
  }));
}

/** Host: accept (link + rename) or reject a claim. */
export async function respondPlayerClaim(claimId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("respond_player_claim", { p_claim_id: claimId, p_accept: accept });
  if (error) throw new Error(error.message);
}
