import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getUnreadCount } from "../../lib/supabase/notificationQueries";
import { useHostSession } from "../../lib/supabase/useHostSession";

/**
 * The header every tab shares: wordmark left, bell right, plus whatever extra
 * control that tab needs (You adds a gear).
 *
 * The bell is deliberately on *every* tab rather than living inside one of
 * them. Notifications here are time-sensitive — "your session just started",
 * "you've been invited to a team" — and burying them one tab deep is what made
 * people miss them. Two icons in the corner is normal; a missed session isn't.
 */
export default function TabHeader({ trailing }: { trailing?: ReactNode }) {
  const { user } = useHostSession();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    getUnreadCount()
      .then((n) => {
        if (!cancelled) setUnread(n);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
      <span className="font-wordmark text-[21px] font-semibold text-ink flex items-baseline leading-none">
        Padelier
        <span className="ml-[3px] w-[6px] h-[6px] rounded-full bg-gold inline-block" aria-hidden />
      </span>

      <div className="flex items-center gap-1.5">
        <Link
          to="/notifications"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95 transition-transform"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
            <path d="M13.7 20a1.9 1.9 0 0 1-3.4 0" />
          </svg>
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-gold text-graphite text-[10px] font-bold flex items-center justify-center border-2 border-ivory tnum"
              aria-hidden
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>
        {trailing}
      </div>
    </div>
  );
}
