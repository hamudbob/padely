import { Link } from "react-router-dom";

/**
 * A small "?" that opens the matching answer on /about.
 *
 * The point is to answer a question exactly where it gets asked — next to the
 * rating, next to the code field — instead of sending someone to a manual and
 * hoping they find the right paragraph. /about opens that entry and scrolls to
 * it, so the tap lands on the answer rather than the top of a page.
 *
 * Deliberately quiet: line-weight border, warm-gray glyph, no fill. It has to
 * be findable when you're looking for it and invisible when you aren't — a
 * gold badge next to every stat would read as a warning.
 *
 * The dot is 17px because anything bigger competes with the label beside it;
 * the tap target is not. The inset pseudo-element pushes the hit area out to
 * ~40px without moving a single pixel of layout.
 */
export default function HelpDot({
  topic,
  label,
  className = "",
}: {
  /** An entry key from aboutContent.ts — e.g. "rating", "join-code". */
  topic: string;
  /** Screen-reader label, since "?" says nothing out loud. */
  label: string;
  className?: string;
}) {
  return (
    <Link
      to={`/about#${topic}`}
      aria-label={label}
      className={
        "relative inline-flex items-center justify-center w-[17px] h-[17px] shrink-0 rounded-full " +
        "border border-line text-warm-gray text-[10.5px] font-bold leading-none align-middle " +
        "before:absolute before:-inset-[11px] before:content-[''] " +
        "active:scale-90 active:border-gold active:text-gold-ink transition-transform " +
        className
      }
    >
      ?
    </Link>
  );
}
