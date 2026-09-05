import { supabase } from "../supabase/client";
import {
  LocalSession,
  listUnsyncedSessions,
  markSynced,
  recordSyncError,
  forgetSyncedSessions,
  toSyncPayload,
  getLocalSession,
} from "./localSession";
import { flush as flushPendingScores } from "../supabase/scoreSyncQueue";
import { applySessionRatings } from "../supabase/ratingActions";
import { applySessionResults } from "../supabase/resultActions";

/**
 * Push sessions that were started offline up to the server.
 *
 * One RPC per session — create_session_from_payload (0060) — which creates the
 * whole graph in a single transaction. All of it lands or none does, so a
 * half-uploaded session is not a state that exists.
 *
 * ── Ordering matters, and it is the subtle part ──────────────────────────
 *
 * scoreSyncQueue holds score writes addressed by MATCH ID. For a session
 * started offline those match ids exist only on the phone, so flushing scores
 * before the session lands would fail every one of them — and after five
 * failures the queue parks an item as un-syncable. An evening's scores would
 * be dropped by the very machinery meant to protect them.
 *
 * So sessions go first, and only then do we prod the score queue. Because the
 * ids were generated on the device and the server accepted them verbatim,
 * every queued score then addresses a row that exists.
 *
 * ── Why it retries forever and never gives up ────────────────────────────
 *
 * A session is somebody's evening: two hours, twelve people, thirty matches.
 * The score queue parks an item after five failures because one bad score
 * must not block the rest — a reasonable trade for one row. Applying it here
 * would mean quietly discarding the whole session, so this keeps the payload
 * and keeps trying, and surfaces the last error instead of hiding it.
 */

let flushing = false;

export interface SyncOutcome {
  synced: number;
  failed: number;
  /** Sessions whose join code the server had to change (collision). */
  codeChanges: { sessionId: string; name: string; joinCode: string }[];
}

export async function syncLocalSessions(): Promise<SyncOutcome> {
  if (flushing) return { synced: 0, failed: 0, codeChanges: [] };
  flushing = true;

  const outcome: SyncOutcome = { synced: 0, failed: 0, codeChanges: [] };

  try {
    const pending = listUnsyncedSessions();
    if (pending.length === 0) {
      forgetSyncedSessions();
      return outcome;
    }

    // Oldest first: if a host ran two sessions in a dead zone, they land in
    // the order they were played.
    pending.sort((a, b) => a.session.created_at.localeCompare(b.session.created_at));

    for (const local of pending) {
      try {
        const { data, error } = await supabase.rpc("create_session_from_payload", {
          p_payload: toSyncPayload(local) as never,
        });
        if (error) throw error;

        const result = (data ?? {}) as {
          join_code?: string;
          public_token?: string;
          code_changed?: boolean;
          already_existed?: boolean;
        };

        markSynced(local.session.id);
        outcome.synced += 1;

        // A session ENDED offline still owes the world two things, and both
        // can only happen server-side: each player's global rating, and the
        // club league row. endSession skipped them because the session did not
        // exist yet; now it does.
        //
        // Both are idempotent server-side (guarded by ratings_applied and
        // results_applied), so a retry after a partial failure cannot
        // double-count — which is what makes it safe to fire them here rather
        // than tracking whether they already ran.
        if (local.session.status === "ended") {
          await applySessionRatings(local.session.id).catch((e: unknown) =>
            console.warn("Rating update deferred for synced session", local.session.id, e),
          );
          await applySessionResults(local.session.id).catch((e: unknown) =>
            console.warn("League results deferred for synced session", local.session.id, e),
          );
        }

        // The server owns the code now. If it had to reassign one, the host
        // needs telling — the code on their screen would otherwise reach a
        // stranger's session, which is worse than no code at all.
        if (result.code_changed && result.join_code) {
          outcome.codeChanges.push({
            sessionId: local.session.id,
            name: local.session.name,
            joinCode: result.join_code,
          });
        }
      } catch (err) {
        outcome.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        recordSyncError(local.session.id, message);
        // Keep going: one session refusing to sync must not hold up another.
        console.warn(`Session ${local.session.id} did not sync:`, message);
      }
    }

    // Only now. See the ordering note above.
    if (outcome.synced > 0) {
      await flushPendingScores().catch(() => undefined);
    }

    forgetSyncedSessions();
    return outcome;
  } finally {
    flushing = false;
  }
}

/**
 * Try whenever the phone might have signal again.
 *
 * `online` fires on regaining connectivity, and `visibilitychange` covers the
 * commoner real case: the app was backgrounded in a car park and reopened at
 * home, where no `online` event ever fired because the OS reconnected while
 * the app was suspended.
 */
export function startLocalSessionSync(): () => void {
  const attempt = () => void syncLocalSessions();

  attempt();
  const onOnline = () => attempt();
  const onVisible = () => {
    if (document.visibilityState === "visible") attempt();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  // A slow backstop for the case both miss: signal that returns while the app
  // is open and idle, which raises no event at all.
  const timer = window.setInterval(attempt, 60_000);

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}

/** Has this session reached the server yet? For the "not synced" marker. */
export function localSyncState(sessionId: string): { local: boolean; error: string | null } {
  const s: LocalSession | null = getLocalSession(sessionId);
  if (!s || s.syncedAt) return { local: false, error: null };
  return { local: true, error: s.lastError };
}
