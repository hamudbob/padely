import { supabase } from "./client";
import { generateNextRound } from "./roundActions";
import { notifyLiveUpdate } from "./liveChannel";
import { graphFromScorerSession, appendPayload } from "../offline/coHostMerge";
import { fetchScorerSession } from "../offline/coHostSync";

/**
 * What a CO-HOST can do — the whole list. Enter a score, and start the next
 * round. Each goes through a SECURITY DEFINER function (0065/0071) that
 * writes only those columns, so nothing else is reachable from this phone
 * however the requests are crafted.
 *
 * A co-host needs signal: the session lives on the host's phone and on the
 * server, never on the co-host's. That is deliberate — two phones each
 * holding "the" session is the problem local-first exists to avoid.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any; // scorer RPCs are not in database.types; always called ON the client

export interface CoHostSessionCard {
  id: string;
  name: string;
  hostName: string | null;
  clubName: string | null;
  startedAt: string | null;
}

/** Live sessions the signed-in user co-hosts. Empty until 0071 is applied. */
export async function getMyCoHostSessions(): Promise<CoHostSessionCard[]> {
  const { data, error } = await db.rpc("my_scorer_sessions");
  if (error) return [];
  return ((data ?? []) as { id: string; name: string; host_name: string | null; club_name: string | null; started_at: string | null }[]).map((r) => ({
    id: r.id,
    name: r.name,
    hostName: r.host_name,
    clubName: r.club_name,
    startedAt: r.started_at,
  }));
}

/** Enter (or correct) a score. Team B may be omitted for fixed-sum formats. */
export async function submitCoHostScore(sessionId: string, matchId: string, scoreA: number, scoreB: number | null): Promise<void> {
  const { error } = await db.rpc("submit_score_as_scorer", {
    p_match_id: matchId,
    p_score_a: scoreA,
    p_score_b: scoreB,
  });
  if (error) throw new Error(error.message);
  notifyLiveUpdate(sessionId); // spectators' boards
}

/**
 * Draw the next round and hand it to the server.
 *
 * Drawn from a FRESH copy of the session, fetched here rather than reusing
 * whatever the screen last showed: the host or another co-host may have
 * scored a match in the meantime, and Mexicano seeds the courts from those
 * very scores. The drawing is the host's own generateNextRound, run on that
 * copy without saving anything (dryRun), so the round is exactly the one the
 * host's phone would have drawn.
 */
export async function advanceRoundAsCoHost(sessionId: string): Promise<{ sequence: number }> {
  const server = await fetchScorerSession(sessionId);
  const graph = graphFromScorerSession(server);
  const drawn = await generateNextRound(sessionId, undefined, false, { graph, dryRun: true });
  const { error } = await db.rpc("append_round_as_scorer", {
    p_session_id: sessionId,
    p_round: appendPayload(graph, drawn.roundId),
  });
  if (error) throw new Error(error.message);
  notifyLiveUpdate(sessionId);
  return { sequence: drawn.sequence };
}
