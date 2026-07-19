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
      <div className="mx-auto max-w-sm min-h-screen bg-white px-4 py-8">
        <p className="text-sm text-slate-400">Checking your session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-white px-4 py-8">
        <h1 className="text-lg font-extrabold mb-2">You need to log in first</h1>
        <p className="text-sm text-slate-500 mb-4">
          Your session isn't active right now — this can happen if you signed up but haven't confirmed your email yet, or
          if you've been logged out.
        </p>
        <Link
          to="/login"
          className="block text-center rounded-xl px-4 py-3 font-bold text-white bg-gradient-to-br from-accent to-accent-dark"
        >
          Go to Log in
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
