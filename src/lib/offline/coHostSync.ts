import { supabase } from "../supabase/client";
import { getLocalSession, updateLocalSession, setLocalCoHostCount } from "./localSession";
import { mergeScorerState, MergeReport, ScorerSession } from "./coHostMerge";

// session_scorers and the scorer RPCs (0065/0071) are not in database.types.
// Always called ON the client: supabase.rpc / .from read `this`, so a detached
// `(supabase.rpc as any)(...)` throws before sending anything.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * The I/O half of co-hosting on the host's phone: fetch the server's copy and
 * fold it in (the rules are in coHostMerge.ts).
 *
 * Kept apart from localSessionSync on purpose: that file pushes, this one
 * pulls, and the push calls this first — never the other way round.
 */

/** Everything a scorer (or the host) may see of one session. 0065/0071. */
export async function fetchScorerSession(sessionId: string): Promise<ScorerSession> {
  const { data, error } = await db.rpc("get_scorer_session", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  return data as unknown as ScorerSession;
}

/**
 * Pull a co-host's scores and rounds into this phone's copy of the session.
 * Returns null when there is nothing to pull from (not held here, not on the
 * server yet, not live), otherwise what was taken. Throws on a network error;
 * callers that run on a timer swallow it and try again next tick.
 */
export async function pullCoHostChanges(sessionId: string): Promise<MergeReport | null> {
  const local = getLocalSession(sessionId);
  if (!local || !local.syncedAt || local.session.status !== "live") return null;
  const server = await fetchScorerSession(sessionId);
  // Read-merge-write in ONE synchronous step, against the copy as it is NOW,
  // not as it was before the request: a score the host tapped while the
  // request was in flight must survive.
  return updateLocalSession(sessionId, (s) => mergeScorerState(s, server));
}

export interface CoHost {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/** The session's co-hosts. Also records the count, which gates pulling. */
export async function listCoHosts(sessionId: string): Promise<CoHost[]> {
  const { data, error } = await db
    .from("session_scorers")
    .select("user_id, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const ids = ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
  setLocalCoHostCount(sessionId, ids.length);
  if (ids.length === 0) return [];
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);
  if (pErr) throw pErr;
  const byId = new Map(((profiles ?? []) as { id: string; display_name: string; avatar_url: string | null }[]).map((p) => [p.id, p]));
  return ids.map((id) => ({
    userId: id,
    displayName: byId.get(id)?.display_name ?? "Player",
    avatarUrl: byId.get(id)?.avatar_url ?? null,
  }));
}

export async function addCoHost(sessionId: string, userId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error("Please sign in.");
  const { error } = await db
    .from("session_scorers")
    .insert({ session_id: sessionId, user_id: userId, added_by: me });
  // Already a co-host is not an error worth showing.
  if (error && (error as { code?: string }).code !== "23505") throw error;
}

export async function removeCoHost(sessionId: string, userId: string): Promise<void> {
  const { error } = await db.from("session_scorers").delete().eq("session_id", sessionId).eq("user_id", userId);
  if (error) throw error;
}
