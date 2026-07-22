import { supabase } from "./client";

/**
 * Player-side join-by-code, backed by the SECURITY DEFINER RPCs in
 * 0005_player_join.sql (granted to anon + authenticated). A joiner never
 * touches a table directly — these three functions are the only surface:
 *
 *  - getJoinSession: validate a code, get the session name to show.
 *  - lookupGuest: pre-fill a returning guest from their email.
 *  - requestJoin: submit a PENDING request the host then confirms.
 *
 * The RPC names aren't in the generated Functions map, so we call through a
 * small typed cast — the same pattern the public-session + old join stubs use.
 */
type RpcFn = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;

export interface JoinSessionInfo {
  id: string;
  name: string;
  format: string;
  status: "draft" | "live";
}

/** Validate a join code; returns the session to join, or null if no open session matches. */
export async function getJoinSession(code: string): Promise<JoinSessionInfo | null> {
  const { data, error } = await rpc("get_join_session", { p_code: code });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const d = data as { id: string; name: string; format: string; status: "draft" | "live" };
  return { id: d.id, name: d.name, format: d.format, status: d.status };
}

export interface GuestPrefill {
  name: string;
  gender: "M" | "F";
  preferredSide: "L" | "R" | null;
}

/** Pre-fill a returning guest from the most recent details tied to their email. */
export async function lookupGuest(email: string): Promise<GuestPrefill | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;
  const { data, error } = await rpc("lookup_guest", { p_email: trimmed });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const d = data as { name: string; gender: "M" | "F"; preferredSide: "L" | "R" | null };
  return { name: d.name, gender: d.gender, preferredSide: d.preferredSide ?? null };
}

export interface RequestJoinInput {
  code: string;
  name: string;
  gender?: "M" | "F";
  teamSide?: "A" | "B" | null;
  preferredSide?: "L" | "R" | null;
  email?: string | null;
}

export interface JoinRequestResult {
  requestId: string;
  sessionId: string;
  sessionName: string;
  sessionStatus: "draft" | "live";
}

/** Submit a join request (pending host confirmation). Does NOT add the player. */
export async function requestJoin(input: RequestJoinInput): Promise<JoinRequestResult> {
  const { data, error } = await rpc("request_join", {
    p_code: input.code,
    p_name: input.name,
    p_gender: input.gender ?? "M",
    p_team_side: input.teamSide ?? null,
    p_preferred_side: input.preferredSide ?? null,
    p_email: input.email ?? null,
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { requestId: string; sessionId: string; sessionName: string; sessionStatus: "draft" | "live" };
  return { requestId: d.requestId, sessionId: d.sessionId, sessionName: d.sessionName, sessionStatus: d.sessionStatus };
}
