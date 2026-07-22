import { submitMatchScore } from "./scoreActions";
import { ScoringFormat } from "../scoring/formats";

/**
 * Offline-first score sync queue.
 *
 * Why this exists: padel is played on courts with terrible WiFi. Entering a
 * score should feel instant and never fail, even with zero signal. So the UI
 * writes the score into this queue (persisted to localStorage) and returns
 * immediately; this module streams the queued writes up to Supabase in the
 * background — retrying on its own when the connection comes back.
 *
 * Scope is deliberately narrow: it ONLY queues per-match score writes, which
 * are self-contained UPDATEs on one row with no ordering dependency between
 * matches. It does NOT try to queue "generate next round" — that pairing is
 * computed server-side from the scores, so it has to wait for this queue to
 * drain first (see flushAndCount + the Next Round handler).
 *
 * At flush time it calls the exact same submitMatchScore the online path used,
 * so validation and the score_edits audit trail behave identically — the only
 * thing that changed is *when* the network call happens.
 */
export interface PendingScore {
  clientId: string;
  sessionId: string;
  matchId: string;
  format: ScoringFormat;
  scoreA: number | null;
  /** Already validated + derived final value (Team B for race/fixed formats). */
  scoreB: number | null;
  editedBy: string;
  reason?: string;
  enqueuedAt: number;
}

const STORAGE_KEY = "padelier:pendingScores:v1";
const RETRY_INTERVAL_MS = 15000;

function makeClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadFromStorage(): PendingScore[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingScore[]) : [];
  } catch {
    return []; // corrupt / unavailable (Safari private mode) — start clean
  }
}

let queue: PendingScore[] = loadFromStorage();
let flushing = false;
let online = typeof navigator !== "undefined" && "onLine" in navigator ? navigator.onLine : true;
const listeners = new Set<() => void>();

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* storage full / unavailable — the in-memory queue still works this session */
  }
}

function emit(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to any change in queue contents / online / flushing state. */
export function subscribeSyncQueue(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getPending(sessionId?: string): PendingScore[] {
  return sessionId ? queue.filter((q) => q.sessionId === sessionId) : [...queue];
}

export function pendingCountFor(sessionId: string): number {
  return queue.filter((q) => q.sessionId === sessionId).length;
}

/**
 * Drop every pending score for a session without uploading. Used when the host
 * deletes/redraws the current round — those queued scores belong to matches
 * that are about to be deleted, so uploading them would fail forever.
 */
export function clearPendingForSession(sessionId: string): void {
  const before = queue.length;
  queue = queue.filter((q) => q.sessionId !== sessionId);
  if (queue.length !== before) {
    persist();
    emit();
  }
}

export function isOnline(): boolean {
  return online;
}

export function isFlushing(): boolean {
  return flushing;
}

/**
 * Queue a score for background upload. Returns synchronously — the caller
 * should already have updated the UI optimistically. If a score for the same
 * match is still pending, it's replaced (latest wins) so we never send a stale
 * value followed by the fresh one.
 */
export function enqueueScore(item: Omit<PendingScore, "clientId" | "enqueuedAt">): void {
  queue = queue.filter((q) => !(q.sessionId === item.sessionId && q.matchId === item.matchId));
  queue.push({ ...item, clientId: makeClientId(), enqueuedAt: Date.now() });
  persist();
  emit();
  void flush();
}

function removeByClientId(clientId: string): void {
  queue = queue.filter((q) => q.clientId !== clientId);
  persist();
}

/**
 * Try to upload every queued score in order. Safe to call anytime — it's a
 * no-op when already running, offline, or empty. Stops on the first failure
 * and leaves the rest queued for the next retry (interval / online event).
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  if (queue.length === 0) return;
  if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return;

  flushing = true;
  emit();
  try {
    // Snapshot up front; enqueue() may mutate `queue` while we await.
    for (const item of [...queue]) {
      // It may have been replaced/removed by a newer enqueue mid-flush.
      if (!queue.some((q) => q.clientId === item.clientId)) continue;
      try {
        await submitMatchScore({
          matchId: item.matchId,
          format: item.format,
          scoreA: item.scoreA,
          scoreB: item.scoreB,
          editedBy: item.editedBy,
          reason: item.reason,
        });
        removeByClientId(item.clientId);
        emit();
      } catch {
        // Likely offline / transient — keep this and everything after it and
        // bail; a later retry picks up where we left off.
        break;
      }
    }
  } finally {
    flushing = false;
    emit();
  }
}

/**
 * Flush, then report how many scores are still pending for this session.
 * The Next Round handler awaits this before generating: 0 means every score
 * is safely on the server and pairing can be computed correctly.
 */
export async function flushAndCount(sessionId: string): Promise<number> {
  await flush();
  return pendingCountFor(sessionId);
}

// --- Background triggers (module-level, run once) ---
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    online = true;
    emit();
    void flush();
  });
  window.addEventListener("offline", () => {
    online = false;
    emit();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  window.setInterval(() => {
    if (queue.length > 0) void flush();
  }, RETRY_INTERVAL_MS);
  // Anything left over from a previous visit (e.g. app was closed while
  // offline) gets flushed as soon as this module loads.
  void flush();
}
