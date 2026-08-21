import { useEffect } from "react";
import Sheet from "./Sheet";

/**
 * Tap a profile photo, see the profile photo. The thing every other app does.
 *
 * Rendered through Sheet, which portals to <body> and locks body scroll — the
 * same reason the modals do: a `fixed` overlay written inside a screen root
 * that carries a filling animation is trapped inside that root's stacking
 * context and paints UNDER the tab bar. See Sheet.tsx for the full story.
 *
 * Deliberately plain: no pinch-zoom, no swipe-to-dismiss, no gallery. There is
 * exactly one image and the only thing anyone wants is to see it bigger, then
 * get out — so the whole backdrop is the way out, Escape works, and there's a
 * visible close button for anyone who doesn't try either.
 */
export default function AvatarLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Sheet>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center anim-fade"
        role="dialog"
        aria-modal="true"
        aria-label={alt}
      >
        {/* Nearly black rather than the modal scrim: a photo should be the only
            lit thing on the screen. */}
        <div className="absolute inset-0 bg-graphite/92" onClick={onClose} />

        <img
          src={src}
          alt={alt}
          onClick={onClose}
          className="relative max-w-[92vw] max-h-[80vh] rounded-2xl object-contain shadow-[0_20px_60px_-12px_rgba(0,0,0,0.6)] anim-pop"
        />

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 w-10 h-10 rounded-full bg-ivory/12 text-ivory text-[18px] leading-none flex items-center justify-center active:bg-ivory/20 transition-colors"
        >
          ✕
        </button>
      </div>
    </Sheet>
  );
}
