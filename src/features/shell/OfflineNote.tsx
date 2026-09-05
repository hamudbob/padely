/**
 * "You're seeing what we last saw."
 *
 * Shown only when a refresh actually FAILED and the screen fell back to
 * cached data — never while a refresh is merely in flight. That distinction
 * is the whole design. A marker that flashes on every navigation becomes
 * furniture within a day, and then it is invisible on the one evening it
 * matters, standing on a court with no bars wondering whether the RSVP list
 * in front of you is real.
 *
 * It carries the TIME rather than a duration. "Showing what you last saw,
 * 15:42" lets someone decide for themselves whether that is fine — before a
 * session it obviously is, ten minutes into one it obviously isn't. "Updated
 * 3 minutes ago" makes them do arithmetic to reach the same conclusion.
 *
 * The whole bar is the retry button, because the usual reason it is on screen
 * is that someone has just walked back into signal and wants to try again —
 * and a small "Retry" word next to a long sentence is a needlessly small
 * target for a thumb.
 */
export default function OfflineNote({
  show,
  at,
  onRetry,
  className = "",
}: {
  show: boolean;
  /** When the shown data was cached (ms). */
  at?: number | null;
  onRetry: () => void;
  className?: string;
}) {
  if (!show) return null;

  const time = at
    ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <button
      type="button"
      onClick={onRetry}
      className={`w-full flex items-center justify-between gap-3 rounded-2xl border border-line bg-gold-soft px-3.5 py-2.5 text-left active:scale-[0.995] transition-transform ${className}`}
    >
      <span className="text-[12px] text-gold-ink leading-relaxed">
        Offline — showing what you last saw{time ? `, ${time}` : ""}.
      </span>
      <span className="text-[12px] font-semibold text-gold-ink shrink-0">Retry</span>
    </button>
  );
}
