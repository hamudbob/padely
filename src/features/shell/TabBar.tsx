import { NavLink } from "react-router-dom";

/**
 * The persistent bottom tab bar — the spine of v2.
 *
 * Everything people kept asking us in person ("how do I join a team", "where's
 * my progress", "how do I change my password") was the same problem: features
 * existed but lived behind cards that were only sometimes on screen. Three
 * always-present destinations fixes all three at once.
 *
 * Design notes, following Apple's tab-bar behaviour:
 *  - Translucent material with content scrolling *under* it, rather than an
 *    opaque strip that permanently eats 64px of a phone screen.
 *  - Feedback on press, not on release — the label and icon respond the instant
 *    a finger lands, which is what makes a tap feel direct rather than laggy.
 *  - No overshoot. Bounce belongs on motion the user threw; a tab that was
 *    tapped should simply arrive.
 *  - Labels are concrete nouns ("Play", "Club", "You"), not umbrellas like
 *    "Home" — specific names let people predict what's behind them.
 */

const TABS = [
  {
    to: "/play",
    label: "Play",
    // Court + ball: the thing you actually came to do.
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 12h18M12 4v16" />
        <circle cx="12" cy="12" r="2.4" />
      </>
    ),
  },
  {
    to: "/teams",
    label: "Club",
    icon: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M2.5 19.5c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" />
        <path d="M16.5 5.6a3.2 3.2 0 0 1 0 6M18 14.4c2.1.7 3.5 2.4 3.5 5.1" />
      </>
    ),
  },
  {
    to: "/profile",
    label: "You",
    icon: (
      <>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M4.5 20c0-3.9 3.4-6.4 7.5-6.4s7.5 2.5 7.5 6.4" />
      </>
    ),
  },
];

export default function TabBar() {
  // The MATERIAL spans the full viewport (inset-x-0); only its CONTENTS are
  // held to the app's centred max-w-sm column. Constraining the bar itself left
  // a strip of page background down each side on any screen wider than 384px —
  // very visible on a Pro Max — and chrome that stops short of the screen edge
  // reads as a broken layout rather than a deliberate one.
  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 inset-x-0 z-40 tabbar-material border-t border-line"
    >
      <ul className="mx-auto max-w-sm flex items-stretch px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                `group flex flex-col items-center justify-center gap-[3px] py-1.5 rounded-2xl select-none ` +
                `transition-[transform,color] duration-150 ease-out active:scale-[0.92] ` +
                (isActive ? "text-graphite" : "text-warm-gray")
              }
            >
              {({ isActive }) => (
                <>
                  <svg
                    width="23"
                    height="23"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={isActive ? 2 : 1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-[stroke-width] duration-150 ease-out"
                    aria-hidden
                  >
                    {tab.icon}
                  </svg>
                  <span className={`text-[10.5px] leading-none ${isActive ? "font-bold" : "font-semibold"}`}>
                    {tab.label}
                  </span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
