import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Start new screens at the top; put you back where you were when you go back.
 *
 * WHAT WAS WRONG. React Router does not touch scroll position on navigation,
 * and the browser keeps whatever offset the window had. So tapping into the
 * league table from halfway down a club page opened the league halfway down
 * too — past the header, past the club logo, into the middle of the table.
 * Every screen looked like it had lost its top.
 *
 * It got worse the day the read cache landed, and that is worth understanding
 * rather than treating as coincidence: before, a new screen rendered a short
 * skeleton, the page was briefly too short to scroll, and the offset collapsed
 * to zero on its own. Now the content is there on the first frame, so there is
 * something to stay scrolled within. The cache did not cause the bug; it
 * removed the accident that was hiding it.
 *
 * ── Why this isn't just scrollTo(0, 0) ────────────────────────────────────
 *
 * Because going BACK is the opposite case. Scroll a long way down a members
 * list, open somebody's profile, come back — landing at the top means finding
 * your place again, every time. Every native app restores that position, and
 * an app that doesn't feels careless in a way people notice without being able
 * to name.
 *
 * React Router tells us which kind of navigation happened. PUSH and REPLACE
 * are "somewhere new" — go to the top. POP is the back button, or the edge
 * swipe — restore what we saved.
 *
 * ── The two-attempt restore ───────────────────────────────────────────────
 *
 * A restore can only scroll as far as the page is tall, and on the frame a
 * route changes the new screen may not have painted its full height yet. One
 * rAF is usually enough now that cached screens render complete; the second
 * attempt on a timeout covers the case where it isn't — a screen still
 * fetching, or images settling — and costs nothing when the first worked,
 * because scrolling to a position you are already at is a no-op.
 */

export function useScrollRestoration(): void {
  const location = useLocation();
  const navigationType = useNavigationType();

  // Keyed by React Router's location key, which is unique per history entry —
  // so two visits to the same club at different depths are remembered
  // separately, exactly as a native stack would.
  const positions = useRef<Map<string, number>>(new Map());
  const previousKey = useRef<string | null>(null);

  useEffect(() => {
    // Save where the SCREEN WE ARE LEAVING was, before the new one paints.
    if (previousKey.current) {
      positions.current.set(previousKey.current, window.scrollY);
    }
    previousKey.current = location.key;

    if (navigationType === "POP") {
      const saved = positions.current.get(location.key) ?? 0;
      const restore = () => window.scrollTo(0, saved);
      requestAnimationFrame(restore);
      const t = window.setTimeout(restore, 120);
      return () => window.clearTimeout(t);
    }

    // Somewhere new. `instant` rather than smooth: a new screen sliding up
    // from a stale offset is an animation of the bug, not a nicety.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [location.key, navigationType]);

  // A map that only ever grows is a leak, however slow. History entries the
  // user can no longer reach are unreachable positions, so trimming the oldest
  // is safe; 50 is far beyond any real back stack.
  useEffect(() => {
    if (positions.current.size <= 50) return;
    const keys = [...positions.current.keys()];
    for (const k of keys.slice(0, keys.length - 50)) positions.current.delete(k);
  }, [location.key]);
}
