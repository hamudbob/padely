import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A modal sheet, rendered into <body> rather than wherever it was written.
 *
 * WHY THIS EXISTS — a bug that cost an afternoon:
 *
 * Every screen root carries `anim-fade`, which is `animation: fade .3s ease
 * both`. `both` includes `forwards`, so the animation keeps *applying* opacity
 * after it finishes — and an element with a filling opacity animation forms a
 * STACKING CONTEXT permanently, exactly as `opacity: 0.99` would.
 *
 * A `fixed inset-0 z-50` sheet written inside that root is therefore not at 50
 * on the page; it is at 50 *inside a box that itself sits at auto*. The tab bar
 * (`z-40`, a sibling of the screen root) then paints OVER the sheet. On a club
 * with a long name the "Done" button lands under the bar and cannot be tapped
 * at all — the e2e run caught it, and it would have been a real dead end on a
 * phone, with no way to close the sheet except a browser back.
 *
 * The fill mode is fixed in index.css too, but a portal is the durable answer:
 * a sheet in <body> is a sibling of the tab bar no matter what any ancestor
 * screen does later — a transform, a filter, `will-change`, another animation.
 * Nobody should have to remember this rule to add a wrapper div.
 *
 * Body scroll is locked while a sheet is open, which is what the nesting used
 * to give us for free on iOS.
 */
export default function Sheet({ children }: { children: ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/* ------------------------------------------------------------------------ */

/**
 * The bottom sheet everything else is built on.
 *
 * WHY IT OWNS THE CHROME. The scrim, the rounded panel and the little grey
 * grabber used to be copy-pasted into every sheet in the app. They drifted:
 * some scrims closed on tap and some didn't, one sheet had no grabber, and
 * NONE of them could be dragged down — which is the gesture anyone who has
 * used an iPhone tries first. A grabber that doesn't respond to a drag is
 * worse than no grabber, because it is a control that lies about being one.
 *
 * Three ways out, and every sheet gets all three:
 *
 *   1. Drag the grabber (or the title beside it) downward. Past 96px, or
 *      flicked faster than 0.5px/ms, it goes; short of that it springs back.
 *      The flick test is what makes a small quick swipe work — without it you
 *      have to drag a third of the screen before anything happens, which feels
 *      broken rather than deliberate.
 *   2. Tap the scrim.
 *   3. Escape, for the desktop web build.
 *
 * The scrim dims as you drag, so the sheet feels attached to your thumb rather
 * than merely following it. Closing is a real animation — the panel slides out
 * and only then does onClose fire — because a sheet that vanishes on the frame
 * you release it reads as a crash.
 */

/** How far, and how fast, counts as "you meant that". */
const DISMISS_DISTANCE = 96; // px
const DISMISS_VELOCITY = 0.5; // px per ms
const CLOSE_MS = 260;

export function BottomSheet({
  onClose,
  title,
  subtitle,
  children,
  /** "sheet" hugs the bottom edge; "card" floats with a margin around it. */
  variant = "sheet",
  scrim = "bg-graphite/55",
  panelClassName = "",
}: {
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  variant?: "sheet" | "card";
  scrim?: string;
  panelClassName?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const [closing, setClosing] = useState(false);
  const dragging = useRef(false);
  const start = useRef({ y: 0, t: 0 });
  const timer = useRef(0);

  const close = useCallback(() => {
    setClosing((already) => {
      if (already) return already;
      timer.current = window.setTimeout(onClose, CLOSE_MS);
      return true;
    });
  }, [onClose]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function onPointerDown(e: React.PointerEvent) {
    if (closing) return;
    dragging.current = true;
    start.current = { y: e.clientY, t: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    // Downward only. Pulling up on a bottom sheet should meet resistance, not
    // lift it off the edge of the screen.
    setDragY(Math.max(0, e.clientY - start.current.y));
  }

  function endDrag(e: React.PointerEvent) {
    if (!dragging.current) return;
    dragging.current = false;
    const dy = Math.max(0, e.clientY - start.current.y);
    const dt = Math.max(1, performance.now() - start.current.t);
    if (dy > DISMISS_DISTANCE || dy / dt > DISMISS_VELOCITY) close();
    else setDragY(0);
  }

  const isSheet = variant === "sheet";

  return (
    <Sheet>
      <div
        className={`fixed inset-0 z-[60] flex items-end justify-center ${isSheet ? "" : "px-4 pb-4"}`}
        role="dialog"
        aria-modal="true"
      >
        <div
          className={`absolute inset-0 ${scrim} anim-fade`}
          onClick={close}
          style={{
            // Dims with the drag, so the sheet feels attached rather than
            // merely followed.
            opacity: closing ? 0 : 1 - Math.min(dragY / 420, 0.6),
            transition: dragging.current ? "none" : `opacity ${CLOSE_MS}ms ease`,
          }}
        />

        <div
          className={`relative w-full max-w-sm bg-ivory anim-rise ${
            isSheet
              ? "rounded-t-[26px] px-5 pt-2.5 pb-7 shadow-[0_-8px_40px_rgba(13,13,13,0.3)] max-h-[92vh] overflow-y-auto"
              : "rounded-3xl px-5 pt-2.5 pb-6 shadow-[0_8px_40px_rgba(13,13,13,0.28)] max-h-[92vh] overflow-y-auto"
          } ${panelClassName}`}
          style={{
            transform: closing ? "translateY(110%)" : dragY ? `translateY(${dragY}px)` : undefined,
            transition: dragging.current ? "none" : `transform ${CLOSE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`,
          }}
        >
          {/* The grabber and the title are one drag surface. Dragging only the
              5px bar would be technically correct and horrible to hit; the
              title above the content is dead space that nobody taps, so it
              costs nothing to make it grabbable too.

              touch-action: none, or iOS treats the gesture as a page scroll
              and the sheet never moves. */}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ touchAction: "none" }}
            /* Sticky, because the panel itself is the scroll container: on a
               long sheet the grabber would otherwise scroll away and the
               gesture would only work at the top. Full-bleed background so
               content passes under it rather than beside it. */
            className="sticky top-0 z-[1] bg-ivory -mx-5 px-5 pt-0.5 cursor-grab active:cursor-grabbing"
          >
            <div className="w-9 h-[5px] rounded-full bg-stone/70 mx-auto mb-3.5" />
            {title && (
              <h4 className="font-serif text-[20px] font-semibold text-graphite text-center">{title}</h4>
            )}
            {subtitle && (
              <p className="text-[12px] text-warm-gray text-center mt-1 mb-4">{subtitle}</p>
            )}
          </div>

          {children}
        </div>
      </div>
    </Sheet>
  );
}
