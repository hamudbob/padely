import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import TabBar from "./TabBar";

/**
 * Layout route for the three tabs. Renders the active tab plus the persistent
 * bottom bar, and nothing else — each tab owns its own header, because a header
 * that tried to serve Play, Club and You at once would end up saying nothing.
 *
 * Scroll behaviour is the part worth getting right. Switching tabs should feel
 * like walking into a different room: you arrive at the top. But coming *back*
 * from a detail page inside a tab should feel like stepping back to where you
 * were standing, so react-router's own restoration handles that case and we
 * deliberately don't fight it — we only reset when the tab itself changes.
 */
const TAB_ROOTS = ["/play", "/teams", "/profile"];

function tabRootOf(pathname: string): string | null {
  return TAB_ROOTS.find((root) => pathname === root) ?? null;
}

export default function AppShell() {
  const location = useLocation();
  const lastTab = useRef<string | null>(null);

  useEffect(() => {
    const tab = tabRootOf(location.pathname);
    if (!tab) return;
    // Only on an actual tab switch — not on a re-render, and not when
    // returning to a tab we were already on.
    if (lastTab.current !== null && lastTab.current !== tab) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    lastTab.current = tab;
  }, [location.pathname]);

  return (
    <div className="mx-auto max-w-sm min-h-screen bg-ivory flex flex-col safe-top">
      {/* tabbar-gap keeps the last row of content clear of the floating bar,
          which sits above the content rather than displacing it. */}
      <div className="flex-1 flex flex-col tabbar-gap">
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}
