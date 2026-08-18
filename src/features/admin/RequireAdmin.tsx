import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { amIAdmin } from "../../lib/supabase/adminQueries";

/**
 * The admin route's gate.
 *
 * Worth being precise about what this does and doesn't do: it is a COURTESY,
 * not a security boundary. The real check lives in every admin RPC, which
 * asks the database whether the caller's profile has is_admin before it
 * returns a single row. Someone who edits this component in devtools gets an
 * admin-shaped screen with nothing in it and "Admins only." in every panel.
 *
 * That's the right way round. A frontend flag that guards data is the classic
 * vibe-coded hole; a frontend flag that guards a menu item is just tidy.
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    amIAdmin()
      .then((ok) => {
        if (!cancelled) setAllowed(ok);
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (allowed === null) {
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-8 safe-top">
        <p className="text-sm text-warm-gray">One moment…</p>
      </div>
    );
  }

  if (!allowed) {
    // Deliberately unhelpful about what lives here. Someone who isn't an admin
    // has no reason to learn that an admin area exists, let alone where.
    return (
      <div className="mx-auto max-w-sm min-h-screen bg-ivory px-5 py-10 safe-top">
        <h1 className="font-serif text-[24px] font-semibold text-graphite">Not found</h1>
        <p className="text-[13.5px] text-ink-2 mt-2">That page isn’t here.</p>
        <Link
          to="/play"
          className="inline-block mt-6 rounded-full px-4 py-3 font-semibold text-[14px] text-ivory bg-graphite active:opacity-90"
        >
          Back to Play
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
