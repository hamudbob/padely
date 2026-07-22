import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";

/**
 * Wrap any page that needs a logged-in host with this. Renders a clear
 * "log in first" message instead of letting the user proceed into a page
 * that will fail later (e.g. losing a half-filled-out Create Session wizard
 * at the very last step because the session had actually expired).
 */
export default function RequireHost({ children }: { children: ReactNode }) {
  const { user, loading } = useHostSession();

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
        <h1 className="font-serif text-[27px] font-medium tracking-tight text-graphite leading-[1.1] mb-2">You need to log in first</h1>
        <p className="text-[13.5px] text-ink-2 mb-4 leading-relaxed">
          Your session isn't active right now — this can happen if you signed up but haven't confirmed your email yet, or
          if you've been logged out.
        </p>
        <Link
          to="/login"
          className="flex items-center justify-center gap-2 rounded-full px-4 py-3.5 font-semibold text-ivory bg-graphite active:scale-[0.99] transition-transform"
        >
          Go to Log in
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
