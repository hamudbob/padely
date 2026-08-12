import { Outlet } from "react-router-dom";
import { useHostSession } from "../../lib/supabase/useHostSession";
import TabBar from "./TabBar";

/**
 * Layout for "places" that aren't tab roots — a club, its league, champions,
 * members, an event, notifications, settings, a final summary.
 *
 * These keep the tab bar. The whole value of a tab bar is that it's always
 * there; if it vanishes the moment you tap anything, you're back to the
 * hierarchical navigation v2 replaced and the bar becomes decoration on three
 * screens. You can be reading a league table and go straight to You without
 * backing out first, which is exactly what a tab bar is for.
 *
 * Tasks deliberately don't use this — the create wizard, a live session, code
 * entry, auth. There, leaving costs you progress, so an always-present shortcut
 * out is a hazard rather than a convenience.
 *
 * The bar only renders when someone is signed in, because two of these routes
 * (an event, a final summary) are also shareable links a stranger might open.
 * For them the tabs would be dead ends, so they simply aren't drawn.
 *
 * Unlike AppShell this adds no container of its own — these pages already have
 * their own `mx-auto max-w-sm` root. All it contributes is the bottom gap so
 * the last row of content clears the floating bar.
 */
export default function SubShell() {
  const { user } = useHostSession();

  return (
    <>
      <div className={user ? "tabbar-gap" : undefined}>
        <Outlet />
      </div>
      {user && <TabBar />}
    </>
  );
}
