import { supabase } from "./client";

/**
 * Host-side management of self-service join requests (0005_player_join.sql).
 * The host reviews pending requests for their session and confirms or rejects
 * them; confirming is what actually inserts the player into the roster (active
 * from the next generated round, exactly like the Manage menu's manual add).
 * All reads/writes here go through normal RLS — the host owns the session.
 */

export interface JoinRequest {
  id: string;
  displayName: string;
  gender: "M" | "F";
  teamSide: "A" | "B" | null;
  preferredSide: "L" | "R" | null;
  email: string | null;
  createdAt: string;
}

/** Pending (not yet confirmed/rejected) join requests for a session, oldest first. */
export async function listJoinRequests(sessionId: string): Promise<JoinRequest[]> {
  const { data, error } = await supabase
    .from("join_requests")
    .select("id, display_name, gender, team_side, preferred_side, email, created_at")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    displayName: r.display_name,
    gender: r.gender,
    teamSide: r.team_side,
    preferredSide: r.preferred_side,
    email: r.email,
    createdAt: r.created_at,
  }));
}

/**
 * Confirms a join request: inserts the player into the roster, then marks the
 * request confirmed and links it to the new player row. join_requests stores
 * the padel side as 'L'/'R'; players.preferred_side uses 'left'/'right', so we
 * map it here at the boundary.
 */
export async function confirmJoinRequest(sessionId: string, request: JoinRequest): Promise<void> {
  const { data: player, error: insertError } = await supabase
    .from("players")
    .insert({
      session_id: sessionId,
      display_name: request.displayName,
      gender: request.gender,
      team_side: request.teamSide,
      preferred_side: request.preferredSide === "L" ? "left" : request.preferredSide === "R" ? "right" : null,
      email: request.email,
      status: "active",
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  if (!player) throw new Error("Could not add the player.");

  const { error: updateError } = await supabase
    .from("join_requests")
    .update({ status: "confirmed", player_id: player.id, decided_at: new Date().toISOString() })
    .eq("id", request.id);
  if (updateError) throw updateError;
}

/**
 * Marks a request confirmed WITHOUT inserting a player row — used by the create
 * wizard's lobby step, which adds the joiner to its own in-memory roster instead
 * (that roster becomes real players when finalizeAndStart runs). The live-session
 * Manage panel uses confirmJoinRequest, which does insert immediately.
 */
export async function acknowledgeJoinRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from("join_requests")
    .update({ status: "confirmed", decided_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) throw error;
}

/** Rejects a join request — the person is not added to the roster. */
export async function rejectJoinRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from("join_requests")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", requestId);
  if (error) throw error;
}
