import { useCallback, useEffect, useRef, useState } from "react";
import { readCache, writeCache, invalidate } from "./cacheStore";

/**
 * Fetch, but show what we already know first.
 *
 * The pattern every adopting screen follows:
 *
 *   const { data, loading, stale, error, refresh } =
 *     useCachedQuery(`club:${clubId}`, () => getClub(clubId));
 *
 *   if (loading) return <SkeletonScreen>…</SkeletonScreen>;   // first visit only
 *   …render data…
 *   {stale && <LastKnownNote onRetry={refresh} />}
 *
 * `loading` is true ONLY when there is nothing to show — a genuine first
 * visit. On every later visit `data` is populated from the moment the
 * component mounts, the fetch runs underneath, and the screen never flickers.
 * That is the entire point: the skeleton stops being a thing you see on every
 * navigation and becomes a thing you see once.
 *
 * `stale` means "this came from disk and the refresh failed" — almost always
 * no signal. It is deliberately NOT set while a background refresh is merely
 * in flight, because a marker that flashes on every navigation is noise, and
 * people learn to ignore it precisely when it starts mattering.
 *
 * ── Two things it refuses to do ──────────────────────────────────────────
 *
 * IT DOES NOT DEDUPE ACROSS COMPONENTS. Two screens asking for the same key at
 * once will both fetch. Fixing that means a request registry and a subscriber
 * model — most of a small library — and this app renders one screen at a time,
 * so the case barely arises. If it starts to, that is the moment to reach for
 * TanStack Query rather than to grow this into it.
 *
 * IT DOES NOT WRITE A FAILED FETCH TO THE CACHE. Obvious, but worth stating:
 * an error must never overwrite good data. Losing a working cached club page
 * because the network hiccuped once would turn a brief outage into a lasting
 * empty screen.
 */

export interface CachedQuery<T> {
  data: T | null;
  /** Only true when there is genuinely nothing to render yet. */
  loading: boolean;
  /** Showing cached data because the refresh failed. */
  stale: boolean;
  error: unknown;
  /** When the shown data was cached, for "last seen at 19:04". */
  cachedAt: number | null;
  refresh: () => void;
  /**
   * Change the shown data immediately, and write it through to the cache.
   *
   * For optimistic updates — tapping "I'm in" on an RSVP must feel instant,
   * not wait for a round trip. Writing through to the cache as well as to
   * state matters: without it, navigating away and back before the server
   * confirms would show the OLD answer from disk, which looks exactly like
   * the tap didn't register.
   *
   * The caller still refetches afterwards. This is optimism, not a substitute
   * for the truth.
   */
  mutate: (updater: (current: T | null) => T | null) => void;
}

export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: { enabled?: boolean } = {},
): CachedQuery<T> {
  const enabled = options.enabled !== false && key !== null;

  // Seeded synchronously from the cache, in the initialiser rather than an
  // effect. An effect would render one empty frame first, which is the flash
  // this hook exists to remove. Read once and shared, so three initialisers
  // don't each hit localStorage and parse the same JSON.
  const seed = key ? readCache<T>(key) : null;
  const [data, setData] = useState<T | null>(seed?.data ?? null);
  const [cachedAt, setCachedAt] = useState<number | null>(seed?.at ?? null);
  const [loading, setLoading] = useState(enabled && !seed);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Declared BEFORE run(), which closes over it. It worked where it was —
  // run() is only ever called from an effect, by which time the const has
  // initialised — but that is a temporal-dead-zone accident, not a design,
  // and the first person to call run() during render would get a bare
  // ReferenceError with nothing pointing at the cause.
  const cancelRef = useRef<(() => void) | null>(null);

  // Held in a ref so changing the fetcher identity between renders — which it
  // does, since call sites write an inline arrow — cannot restart the fetch on
  // every render. The key is what decides when to refetch.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    if (!key || !enabled) return;
    // Guards against a late response from a previous key overwriting the
    // current one — navigate club A → club B quickly and A's response can
    // still be in flight.
    let cancelled = false;
    cancelRef.current?.();
    cancelRef.current = () => {
      cancelled = true;
    };

    try {
      const fresh = await fetcherRef.current();
      if (cancelled) return;
      setData(fresh);
      setCachedAt(Date.now());
      setStale(false);
      setError(null);
      writeCache(key, fresh);
    } catch (err) {
      if (cancelled) return;
      // Never overwrite good data with a failure.
      const cached = readCache<T>(key);
      if (cached) {
        setStale(true);
      } else {
        setError(err);
      }
    } finally {
      if (!cancelled) setLoading(false);
    }
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled || !key) return;
    // Re-seed on a key change: moving from club A to club B must show B's
    // cached data, not A's, and must show B's skeleton if B has never loaded.
    const cached = readCache<T>(key);
    setData(cached?.data ?? null);
    setCachedAt(cached?.at ?? null);
    setLoading(!cached);
    setStale(false);
    setError(null);
    void run();
    return () => cancelRef.current?.();
  }, [key, enabled, run]);

  const mutate = useCallback(
    (updater: (current: T | null) => T | null) => {
      setData((current) => {
        const next = updater(current);
        if (key && next !== null) writeCache(key, next);
        return next;
      });
    },
    [key],
  );

  return { data, loading, stale, error, cachedAt, refresh: run, mutate };
}

/** Drop a key so the next mount refetches — call after a write that changes it. */
export const invalidateQuery = invalidate;
