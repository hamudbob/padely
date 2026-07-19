import { supabase } from "./client";

/**
 * Mid-session host actions — the "Manage" menu on Host Live: rename a
 * court, mark one unavailable/available (future round generation already
 * filters courts.available = true — see roundActions.ts's `availableCourts`
 * — so toggling here takes effect starting with the NEXT round, never
 * retroactively touching a round already in progress), add a late player,
 * or mark a player as left (excluded the same way — every round generator
 * filters players.status = 'active').
 */

export async function renameCourt(courtId: string, displayName: string): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed) throw new Error("Court name can't be empty.");
  const { error } = await supabase.from("courts").update({ display_name: trimmed }).eq("id", courtId);
  if (error) throw error;
}

export async function setCourtAvailability(courtId: string, available: boolean): Promise<void> {
  const { error } = await supabase.from("courts").update({ available }).eq("id", courtId);
  if (error) throw error;
}

export interface AddLatePlayerInput {
  sessionId: string;
  name: string;
  gender: "M" | "F";
  /** Team Sparring only — which side the new player joins. */
  teamSide?: "A" | "B";
}

/**
 * Adds a player mid-session, active starting with the NEXT generated round
 * (never retroactively added to a round already in progress or scored).
 * Fixed Partner sessions block this from the UI — a locked-pairs format has
 * nobody for a newcomer to be paired with, so HostLivePage doesn't even
 * offer the option there; this function itself doesn't re-check that, since
 * the caller is the single source of truth for when it's offered.
 */
export async function addLatePlayer(input: AddLatePlayerInput): Promise<{ id: string }> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Player name can't be empty.");
  const { data, error } = await supabase
    .from("players")
    .insert({
      session_id: input.sessionId,
      display_name: trimmed,
      gender: input.gender,
      team_side: input.teamSide ?? null,
      status: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  if (!data) throw new Error("Failed to add the player — no row was returned.");
  return { id: data.id };
}

/** Excludes a player from every future round (already-played rounds/scores are untouched). */
export async function markPlayerLeft(playerId: string): Promise<void> {
  const { error } = await supabase.from("players").update({ status: "left", left_at: new Date().toISOString() }).eq("id", playerId);
  if (error) throw error;
}

/** Undoes markPlayerLeft — the player is eligible again starting with the next generated round. */
export async function restorePlayer(playerId: string): Promise<void> {
  const { error } = await supabase.from("players").update({ status: "active", left_at: null }).eq("id", playerId);
  if (error) throw error;
}
