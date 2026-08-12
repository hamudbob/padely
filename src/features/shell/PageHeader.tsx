import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useBackNav } from "../../lib/useBackNav";

/**
 * The header for any screen that ISN'T a tab root — a club, a league table, the
 * create wizard, a live session.
 *
 * Tab roots use TabHeader (wordmark + bell, no back button, because there's
 * nowhere above them). Everything else uses this: back on the left, wordmark in
 * the middle, and whatever that page needs on the right.
 *
 * It exists because these headers had drifted. Most pages had back + wordmark,
 * the create wizard had a bare back button with no wordmark at all, the live
 * session had back + a menu but no wordmark, and the final summary had no
 * header whatsoever. Same idea, four shapes.
 *
 * The wordmark is not decoration here. On a screen with no tab bar — which is
 * every task screen — it's the only thing telling you which app you're in, and
 * it's a link home, so it doubles as the escape hatch from a flow.
 */
export default function PageHeader({
  fallback = "/",
  onBack,
  trailing,
  className = "",
}: {
  /** Where back goes when there's no history to pop (opened from a link). */
  fallback?: string;
  /** Override back entirely — the create wizard steps backwards through itself. */
  onBack?: () => void;
  trailing?: ReactNode;
  className?: string;
}) {
  const back = useBackNav(fallback);

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <button
        onClick={onBack ?? back}
        aria-label="Back"
        className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <Link
        to="/"
        aria-label="Home"
        className="font-wordmark text-[16px] font-semibold text-graphite flex items-baseline leading-none active:opacity-70"
      >
        Padelier<span className="ml-[3px] w-[5px] h-[5px] rounded-full bg-gold inline-block" aria-hidden />
      </Link>

      {/* Keeps the wordmark optically centred whether or not there's an action. */}
      {trailing ?? <div className="w-9 shrink-0" />}
    </div>
  );
}
