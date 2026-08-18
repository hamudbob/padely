import { ReactNode, useEffect } from "react";
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
