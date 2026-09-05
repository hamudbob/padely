import { RefObject, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isNative } from "./native";

/**
 * Drag from the left edge to go back, with the screen following your thumb.
 *
 * ── Why this is written by hand and not switched on ───────────────────────
 *
 * WKWebView has this gesture built in: `allowsBackForwardNavigationGestures`.
 * One line in a subclassed CAPBridgeViewController and it works. It is also
 * the wrong choice here, because Apple's own developer forums carry a standing
 * report that from iOS 17.5.1 onward that gesture desynchronises from a
 * single-page app's `pushState` history and sometimes navigates to the FIRST
 * page rather than the previous one. Padelier is a pushState app. A swipe that
 * occasionally throws someone from the middle of a live session back to the
 * home screen is worse than having no swipe, because it is unpredictable —
 * people stop trusting the gesture and can't say why.
 *
 * Doing it in JavaScript costs about a hundred lines and buys exact control:
 * it moves through React Router's history, one entry, every time.
 *
 * ── The rules it follows, which are iOS's rules ───────────────────────────
 *
 * ONLY FROM THE EDGE. The drag has to start within 24px of the left side.
 * That is what stops it fighting a horizontal scroller, a slider, or a
 * left-swipe inside some future carousel — the same reason iOS restricts it.
 *
 * ONLY WHEN THERE IS SOMEWHERE TO GO. React Router stamps the first entry of a
 * session with the key "default". On that entry, going back would leave the
 * app entirely, so there is no gesture at all — iOS likewise offers nothing at
 * the root of a stack. This is the same test `useBackNav` uses for its button,
 * so the button and the gesture can never disagree.
 *
 * NOT OVER A SHEET. A bottom sheet is its own modal layer with its own drag,
 * and pulling the page out from underneath one would be nonsense. If anything
 * with role="dialog" is on screen, the gesture stands down.
 *
 * COMMIT ON DISTANCE OR SPEED. A third of the screen, or a flick faster than
 * 0.45px/ms. Distance alone makes a quick confident swipe feel broken; speed
 * alone makes a slow deliberate drag impossible.
 *
 * ── One thing that matters more than it looks ─────────────────────────────
 *
 * The transform is REMOVED, not set to none, the moment the gesture finishes.
 * An element with a transform forms a stacking context, and this app has
 * already lost an afternoon to exactly that: a `fixed` sheet inside a
 * transformed ancestor is positioned against the ancestor, not the viewport,
 * and the tab bar paints over it (see the note at the top of Sheet.tsx). At
 * rest this wrapper must carry no transform at all, so nothing downstream
 * behaves differently because the file exists.
 */

const EDGE_ZONE = 24; // px from the left edge where a drag may start
const COMMIT_FRACTION = 0.32; // of the screen width
const COMMIT_VELOCITY = 0.45; // px per ms
const DURATION = 260; // matches BottomSheet's close, so the app has one tempo

export function useEdgeSwipeBack(ref: RefObject<HTMLElement>): void {
  const navigate = useNavigate();
  const location = useLocation();

  // Read inside the handlers rather than captured, so a listener attached once
  // never acts on a stale idea of where we are.
  const canGoBack = useRef(false);
  canGoBack.current = Boolean(location.key && location.key !== "default");

  useEffect(() => {
    // Native only. On a desktop browser the back button and the trackpad
    // gesture already exist, and hijacking a drag there would be a surprise.
    if (!isNative()) return;
    const el = ref.current;
    if (!el) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dx = 0;
    // Undecided until the finger has moved enough to reveal an intent. This is
    // what keeps a vertical scroll that happens to begin near the edge from
    // being read as a back gesture.
    let axis: "undecided" | "horizontal" | "vertical" = "undecided";

    const width = () => window.innerWidth || 390;

    function paint(x: number) {
      el!.style.transform = `translate3d(${x}px,0,0)`;
      // A shadow only while it is off its resting place, so the page looks
      // like a card being slid aside rather than a layer that was always there.
      el!.style.boxShadow = x > 0 ? "-12px 0 32px rgba(13,13,13,0.18)" : "";
    }

    /** Put everything back exactly as it was — see the note above about
     *  stacking contexts. `removeProperty`, not "none". */
    function clear() {
      el!.style.removeProperty("transform");
      el!.style.removeProperty("box-shadow");
      el!.style.removeProperty("transition");
      el!.style.removeProperty("will-change");
    }

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      if (!canGoBack.current) return;
      // A sheet owns the screen while it is open.
      if (document.querySelector('[role="dialog"]')) return;

      const t = e.touches[0];
      if (t.clientX > EDGE_ZONE) return;

      dragging = true;
      axis = "undecided";
      startX = t.clientX;
      startY = t.clientY;
      startT = performance.now();
      dx = 0;
      el!.style.transition = "none";
      el!.style.willChange = "transform";
    }

    function onMove(e: TouchEvent) {
      if (!dragging) return;
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;

      if (axis === "undecided") {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        // Ratio, not raw magnitude: a mostly-sideways move at the edge is a
        // back gesture; anything steeper is a scroll and we let it go.
        axis = Math.abs(mx) > Math.abs(my) * 1.2 ? "horizontal" : "vertical";
        if (axis === "vertical") {
          dragging = false;
          clear();
          return;
        }
      }

      // Rightwards only. Pulling left from the edge has no meaning here.
      dx = Math.max(0, mx);
      // The page must not scroll under a gesture that is moving it.
      if (e.cancelable) e.preventDefault();
      paint(dx);
    }

    function onEnd() {
      if (!dragging) return;
      dragging = false;
      el!.style.willChange = "";

      const dt = Math.max(1, performance.now() - startT);
      const commit = dx > width() * COMMIT_FRACTION || dx / dt > COMMIT_VELOCITY;

      if (!commit) {
        el!.style.transition = `transform ${DURATION}ms cubic-bezier(0.22,0.61,0.36,1), box-shadow ${DURATION}ms ease`;
        paint(0);
        window.setTimeout(clear, DURATION);
        return;
      }

      // Off the right edge first, THEN navigate. Navigating on release and
      // animating afterwards shows the destination sliding out, which is
      // backwards and reads as a glitch.
      el!.style.transition = `transform ${DURATION}ms cubic-bezier(0.22,0.61,0.36,1)`;
      paint(width());
      window.setTimeout(() => {
        navigate(-1);
        // One frame after the route changes, so the incoming screen is never
        // painted while the wrapper is still shifted.
        requestAnimationFrame(clear);
      }, DURATION);
    }

    // passive:false on move only — it is the one that calls preventDefault.
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
      clear();
    };
  }, [ref, navigate]);
}
