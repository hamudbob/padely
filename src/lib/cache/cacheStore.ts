import { supabase } from "../supabase/client";

/**
 * A small persisted read cache, so the app stops showing a skeleton for data
 * it already has.
 *
 * WHAT WAS WRONG. Every screen fetched on mount and rendered a skeleton while
 * it waited. Walk club → league → back → members and you are shown four
 * loading states for data that has not changed in a week. On a court with bad
 * signal, each of those is a real wait; the app felt slow because it *was*
 * slow, every single time.
 *
 * WHAT THIS DOES. Stale-while-revalidate. A screen renders whatever we last
 * saw, immediately, and the fetch happens underneath; if the answer differs,
 * it swaps in quietly. The skeleton now appears exactly once per screen, the
 * first time you ever open it. Cold-start on a court with no bars still shows
 * your club, your sessions and the league as they were.
 *
 * It pairs with scoreSyncQueue, which already does the other half — writes
 * survive offline. Reads now do too.
 *
 * ── The part that actually matters: whose data is this? ───────────────────
 *
 * A persisted cache's worst failure is not staleness, it is showing one
 * person's data to another. Sign out on a shared phone, let a club-mate sign
 * in, and a cache keyed only by screen would hand them your clubs, your
 * sessions and your rating — from disk, instantly, before any fetch could
 * correct it. That is a privacy breach the network never touches, so no
 * amount of server-side RLS prevents it.
 *
 * So every key is namespaced by user id, the namespace is only set once we
 * know who is signed in, and SIGNING OUT ERASES THE NAMESPACE'S DATA rather
 * than merely switching away from it. With no namespace, this module does
 * nothing at all — no reads, no writes — which is the correct behaviour for
 * "we don't yet know who you are".
 *
 * ── What must never go in here ────────────────────────────────────────────
 *
 * Anything whose staleness is dangerous rather than untidy: live scores, the
 * current round, anything a host reads aloud and acts on. Structure is fine —
 * a session's players and courts do not change mid-match — but a number
 * somebody might enter into the next round is not.
 *
 * Also: only JSON-safe payloads. A Map or a Date survives in memory and dies
 * on the way to disk (`JSON.stringify(new Map())` is `{}`), which would make
 * a cached read behave differently from a fresh one — the worst kind of bug,
 * because it only appears on the second visit.
 */

/** Bump to invalidate every cached payload at once after a shape change. */
const VERSION = "v1";
const PREFIX = `padelier:cache:${VERSION}:`;
/** localStorage is ~5MB; staying well under it leaves room for the score queue. */
const MAX_BYTES = 1_800_000;

interface Entry<T> {
  /** When this was written, so a caller can decide how stale is too stale. */
  at: number;
  data: T;
}

let namespace: string | null = null;

const fullKey = (key: string) => `${PREFIX}${namespace}:${key}`;

/* ── Namespace lifecycle ─────────────────────────────────────────────────── */

/**
 * Wire the cache to the session. Called once from main.tsx, before render.
 *
 * onAuthStateChange fires INITIAL_SESSION on subscribe, so the namespace is
 * set before the first screen mounts in the ordinary case. Where it isn't —
 * a slow restore — reads simply miss and the screen fetches, which is the old
 * behaviour, not a broken one.
 */
export function startCacheNamespace(): void {
  supabase.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id ?? null;

    if (event === "SIGNED_OUT" || !uid) {
      // Erase, don't just detach. Leaving the previous user's rows on disk to
      // be "protected" by a namespace they no longer match is a bet that no
      // future bug ever gets the namespace wrong. Deleting them is not a bet.
      clearAll();
      namespace = null;
      return;
    }

    if (namespace && namespace !== uid) clearAll();
    namespace = uid;
  });
}

/* ── Read and write ──────────────────────────────────────────────────────── */

/** Whatever we last saw for this key, or null. Never throws. */
export function readCache<T>(key: string): { data: T; at: number } | null {
  if (!namespace) return null;
  try {
    const raw = localStorage.getItem(fullKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || typeof entry.at !== "number") return null;
    return { data: entry.data, at: entry.at };
  } catch {
    // Corrupt or unparseable: treat as a miss. A cache that throws is worse
    // than no cache.
    return null;
  }
}

export function writeCache<T>(key: string, data: T): void {
  if (!namespace) return;
  try {
    localStorage.setItem(fullKey(key), JSON.stringify({ at: Date.now(), data } satisfies Entry<T>));
  } catch {
    // Quota. Evict the oldest half and try once more; if it still fails, give
    // up silently — a missing cache entry costs a skeleton, and throwing here
    // would break a screen that had already rendered fine.
    evictOldest();
    try {
      localStorage.setItem(fullKey(key), JSON.stringify({ at: Date.now(), data } satisfies Entry<T>));
    } catch {
      /* nothing more to do */
    }
  }
}

export function invalidate(key: string): void {
  if (!namespace) return;
  try {
    localStorage.removeItem(fullKey(key));
  } catch {
    /* ignore */
  }
}

/** Drop every cached payload, for every user. Used on sign-out. */
export function clearAll(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/* ── Housekeeping ────────────────────────────────────────────────────────── */

/**
 * Drop the oldest half of the cache, and anything from a previous VERSION.
 *
 * Called on quota errors rather than on a timer: the cost of an over-full
 * cache is one failed write, and scanning localStorage on every navigation to
 * prevent that would be a worse trade.
 */
function evictOldest(): void {
  try {
    const entries: { key: string; at: number; size: number }[] = [];
    let total = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // A key from an older VERSION can never be read again — it goes first,
      // whatever its age.
      if (k.startsWith("padelier:cache:") && !k.startsWith(PREFIX)) {
        localStorage.removeItem(k);
        continue;
      }
      if (!k.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(k) ?? "";
      total += raw.length * 2; // UTF-16
      let at = 0;
      try {
        at = (JSON.parse(raw) as Entry<unknown>).at ?? 0;
      } catch {
        at = 0; // unparseable sorts oldest, which is where we want it
      }
      entries.push({ key: k, at, size: raw.length * 2 });
    }

    entries.sort((a, b) => a.at - b.at);
    let freed = 0;
    const target = Math.max(total - MAX_BYTES, total / 2);
    for (const e of entries) {
      if (freed >= target) break;
      localStorage.removeItem(e.key);
      freed += e.size;
    }
  } catch {
    /* ignore */
  }
}
