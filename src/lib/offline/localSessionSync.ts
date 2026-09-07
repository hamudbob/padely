import { supabase } from "../supabase/client";
import {
  LocalSession,
  listUnsyncedSessions,
  markSynced,
  recordSyncError,
  forgetSyncedSessions,
  toSyncPayload,
  getLocalSession,
  saveLocalSession,
  onLocalSessionChange,
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
  // With no connection every request below would sit until it times out, and
  // this runs at startup — which is how a launch in Airplane Mode ended up
  // slower than a launch with signal. The `online` and `visibilitychange`
  // listeners bring us straight back the moment there is a network.
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
    return { synced: 0, failed: 0, codeChanges: [] };
  }
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
  const stopReplication = startReplication();
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
    stopReplication();
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


/* ── Replication of a session the server already has ─────────────────────── */

/**
 * Push the current state of a live session, and merge back anything only the
 * server could know.
 *
 * WHY THIS EXISTS SEPARATELY FROM syncLocalSessions. That one CREATES a
 * session the server has never seen. This one keeps an existing one current —
 * every round drawn, every score, every player marked as left after the first
 * upload. Without it, a session that synced early and then ran for two more
 * hours would leave everything after the first push on the phone alone.
 *
 * Debounced, because a host tapping through a round produces a burst of
 * mutations and the server only needs the settled result. Short, because
 * local-first must not become "sync later": with signal the server should be
 * seconds behind, so a lost phone costs seconds rather than an evening.
 */
const DEBOUNCE_MS = 1500;
const timers = new Map<string, number>();
const inFlight = new Set<string>();

export async function replicateSession(sessionId: string): Promise<void> {
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return;
  const local = getLocalSession(sessionId);
  // Nothing to push if it has never been created server-side; syncLocalSessions
  // owns that case and will call back here afterwards.
  if (!local || !local.syncedAt) return;
  if (inFlight.has(sessionId)) return;
  inFlight.add(sessionId);

  try {
    const { data, error } = await supabase.rpc("sync_session_state", {
      p_payload: toSyncPayload(local) as never,
    });
    if (error) throw error;

    const result = (data ?? {}) as { new_players?: Record<string, unknown>[] };
    const incoming = result.new_players ?? [];
    if (incoming.length > 0) {
      // Players who joined by code. They wrote to the server from their own
      // phone, so this device has never seen them — and they must appear in
      // the roster before the next draw, or they will not be picked.
      const fresh = getLocalSession(sessionId);
      if (fresh) {
        const known = new Set(fresh.players.map((p) => p.id));
        for (const row of incoming) {
          const id = String(row.id ?? "");
          if (!id || known.has(id)) continue;
          fresh.players.push({
            id,
            session_id: sessionId,
            display_name: String(row.display_name ?? "Player"),
            gender: String(row.gender ?? "M"),
            linked_user_id: (row.linked_user_id as string | null) ?? null,
            team_side: (row.team_side as string | null) ?? null,
            preferred_side: (row.preferred_side as string | null) ?? null,
            status: (row.status as "active" | "late" | "left") ?? "active",
            matches_played: 0,
            rests: 0,
            joined_at: String(row.joined_at ?? new Date().toISOString()),
          });
        }
        saveLocalSession(fresh);
      }
    }

    // A session ended locally owes two server-side things: each player's
    // global rating, and the club league row. Both were already handled for a
    // session created by syncLocalSessions — but a session that synced EARLY
    // and ended later comes through here instead, and without this its league
    // row would never be written. The night would score correctly on every
    // screen and quietly never reach the table.
    //
    // Both are idempotent server-side (ratings_applied / results_applied), so
    // firing them on every replication of an ended session cannot double-count.
    if (local.session.status === "ended") {
      await applySessionRatings(sessionId).catch((e: unknown) =>
        console.warn("Rating update deferred for", sessionId, e),
      );
      await applySessionResults(sessionId).catch((e: unknown) =>
        console.warn("League results deferred for", sessionId, e),
      );
    }
  } catch (err) {
    // Never surfaced. A failed replication is invisible to the host by design:
    // the session on their screen is correct and complete, and the next
    // mutation — or the periodic sweep — pushes again. Telling them would be
    // reporting our plumbing.
    console.warn("Session replication deferred:", err instanceof Error ? err.message : err);
  } finally {
    inFlight.delete(sessionId);
  }
}

/** Register the debounced replicate. Called once, from startLocalSessionSync. */
function startReplication(): () => void {
  return onLocalSessionChange((sessionId) => {
    const existing = timers.get(sessionId);
    if (existing) window.clearTimeout(existing);
    timers.set(
      sessionId,
      window.setTimeout(() => {
        timers.delete(sessionId);
        void replicateSession(sessionId);
      }, DEBOUNCE_MS),
    );
  });
}
