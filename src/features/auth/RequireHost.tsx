import { ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import { useBackNav } from "../../lib/useBackNav";
import { getMyProfile } from "../../lib/supabase/profileQueries";

/**
 * Wrap any page that needs a logged-in host with this. Renders a clear
 * "log in first" message instead of letting the user proceed into a page
 * that will fail later (e.g. losing a half-filled-out Create Session wizard
 * at the very last step because the session had actually expired).
 */
export default function RequireHost({ children }: { children: ReactNode }) {
  const { user, loading } = useHostSession();
  const location = useLocation();
  const here = location.pathname + location.search;
  const loginHref = `/login?next=${encodeURIComponent(here)}`;
  const back = useBackNav("/");

  // Onboarding gate. A brand-new account has confirmed its email but has no
  // name, side or gender yet, so it goes to /welcome first. `null` means "not
  // checked yet"; `false` covers both "already onboarded" and "the check
  // failed", because a lookup error must never lock someone out of their app.
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const onWelcome = location.pathname === "/welcome"; // never redirect to itself

  useEffect(() => {
    if (!user || onWelcome) {
      setNeedsOnboarding(false);
      return;
    }
    let cancelled = false;
    getMyProfile()
      .then((p) => {
        if (!cancelled) setNeedsOnboarding(p?.needsOnboarding ?? false);
      })
      .catch(() => {
        if (!cancelled) setNeedsOnboarding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, onWelcome]);

  const topBar = (
    <div className="flex items-center justify-between mb-8">
      <button
        onClick={back}
        aria-label="Back"
        className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center text-[17px] active:scale-95 transition-transform"
      >
        ‹
      </button>
      <Link to="/" aria-label="Home" className="font-wordmark text-[20px] font-semibold text-graphite flex items-baseline leading-none active:opacity-70">
        Padelier<span className="ml-[3px] w-[6px] h-[6px] rounded-full bg-gold inline-block" aria-hidden />
      </Link>
      <Link
        to="/"
        aria-label="Home"
        className="w-9 h-9 rounded-full border border-line bg-surface text-ink-2 flex items-center justify-center active:scale-95 transition-transform"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      </Link>
    </div>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
        <p className="text-sm text-warm-gray">Checking your session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
        {topBar}
        <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1] mb-2">You need to log in first</h1>
        <p className="text-[13.5px] text-ink-2 mb-4 leading-relaxed">
          Your session isn't active right now — this can happen if you signed up but haven't confirmed your email yet, or
          if you've been logged out.
        </p>
        <Link
          to={loginHref}
          className="flex items-center justify-center gap-2 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
        >
          Go to Log in
        </Link>
      </div>
    );
  }

  // Hold the page back for the one frame the profile check takes, so a new
  // account never sees a flash of the app before being sent to /welcome.
  if (needsOnboarding === null) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8">
        <p className="text-sm text-warm-gray">Checking your session…</p>
      </div>
    );
  }

  if (needsOnboarding) {
    return <Navigate to={`/welcome?next=${encodeURIComponent(here)}`} replace />;
  }

  return <>{children}</>;
}
