import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { Team } from "../../../lib/supabase/teamQueries";
import { GearIcon } from "./ui";

export type ClubTab = "club" | "league" | "champions" | "members";

export const CLUB_TABS: { value: ClubTab; label: string }[] = [
  { value: "club", label: "Club" },
  { value: "league", label: "League" },
  { value: "champions", label: "Champions" },
  { value: "members", label: "Members" },
];

function TabSwitch({ tab, onTab, membersDot, compact }: { tab: ClubTab; onTab: (t: ClubTab) => void; membersDot: boolean; compact?: boolean }) {
  return (
    <nav role="tablist" aria-label="Club" className="flex p-[3px] rounded-full bg-surface/55">
      {CLUB_TABS.map((t) => {
        const on = t.value === tab;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onTab(t.value)}
            className={`flex-1 rounded-full font-semibold text-[12.5px] transition-colors active:opacity-80 ${compact ? "py-[7px]" : "py-2"} ${
              on ? "bg-surface text-graphite shadow-[0_1px_3px_rgba(13,13,13,0.1)]" : "text-gold-ink"
            }`}
          >
            {t.label}
            {t.value === "members" && membersDot && (
              <span className="inline-block w-[6px] h-[6px] rounded-full bg-loss ml-1 align-middle" aria-label="Someone wants to join" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The club's gold band: name, one line about you, and the four tabs. Once the
 * tabs scroll away, a slim frosted bar with the name and the same tabs takes
 * over at the top, so switching never means scrolling back up.
 */
export default function ClubHeader({
  team,
  subline,
  tab,
  onTab,
  isAdmin,
  onBack,
  onLogo,
  logoBusy,
  membersDot,
}: {
  team: Team;
  subline: ReactNode;
  tab: ClubTab;
  onTab: (t: ClubTab) => void;
  isAdmin: boolean;
  onBack: () => void;
  onLogo?: () => void;
  logoBusy?: boolean;
  membersDot: boolean;
}) {
  const navRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // The bar is ~96px tall under the notch; the band's tabs count as gone
    // once they slide under it.
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 120), {
      rootMargin: "-96px 0px 0px 0px",
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const gear = isAdmin ? (
    <Link
      to={`/teams/${team.id}/settings`}
      aria-label="Club settings"
      className="w-9 h-9 rounded-full bg-surface/75 text-ink-2 flex items-center justify-center active:scale-95 transition-transform"
    >
      <GearIcon />
    </Link>
  ) : (
    <span className="w-9" />
  );

  const logo = (
    <span className="w-[34px] h-[34px] rounded-[11px] bg-surface text-gold-ink font-serif font-semibold text-[16px] flex items-center justify-center overflow-hidden">
      {team.logoUrl ? <img src={team.logoUrl} alt="" className="w-full h-full object-cover" /> : team.name.charAt(0).toUpperCase()}
    </span>
  );

  return (
    <>
      <header className="bg-gold-soft rounded-b-[28px] px-5 pb-4" style={{ paddingTop: "max(1.1rem, env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between h-11">
          <button onClick={onBack} aria-label="Back" className="w-9 h-9 rounded-full bg-surface/75 text-ink-2 flex items-center justify-center text-[18px] active:scale-95 transition-transform">
            ‹
          </button>
          {isAdmin && onLogo ? (
            <button onClick={onLogo} disabled={logoBusy} aria-label="Change club logo" className="relative active:scale-95 transition-transform disabled:opacity-60">
              {logo}
              <span className="absolute -bottom-1 -right-1 w-[16px] h-[16px] rounded-full bg-gold border-2 border-gold-soft flex items-center justify-center" aria-hidden>
                {logoBusy ? (
                  <span className="w-1.5 h-1.5 border border-graphite/40 border-t-graphite rounded-full animate-spin" />
                ) : (
                  <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#0D0D0D" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                )}
              </span>
            </button>
          ) : (
            logo
          )}
          {gear}
        </div>
        <h1 className="font-serif text-[32px] leading-[1.05] font-semibold tracking-[-0.02em] text-graphite mt-3.5">{team.name}</h1>
        <div className="text-[12.5px] font-semibold text-gold-ink mt-1.5">{subline}</div>
        <div ref={navRef} className="mt-4">
          <TabSwitch tab={tab} onTab={onTab} membersDot={membersDot} />
        </div>
      </header>

      {typeof document !== "undefined" &&
        createPortal(
          <div
            aria-hidden={!compact}
            className={`fixed top-0 inset-x-0 z-30 transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
              compact ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
            }`}
          >
            <div
              className="mx-auto max-w-sm px-5 pb-3 rounded-b-[22px] bg-gold-soft/90 backdrop-blur-xl shadow-[0_8px_20px_-14px_rgba(131,101,41,0.45)]"
              style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
            >
              <div className="flex items-center gap-2.5 h-9">
                <button onClick={onBack} tabIndex={compact ? 0 : -1} aria-label="Back" className="w-8 h-8 rounded-full bg-surface/75 text-ink-2 flex items-center justify-center text-[16px]">
                  ‹
                </button>
                <span className="flex-1 text-center font-serif text-[16px] font-semibold text-graphite truncate">{team.name}</span>
                {isAdmin ? (
                  <Link to={`/teams/${team.id}/settings`} tabIndex={compact ? 0 : -1} aria-label="Club settings" className="w-8 h-8 rounded-full bg-surface/75 text-ink-2 flex items-center justify-center">
                    <GearIcon size={15} />
                  </Link>
                ) : (
                  <span className="w-8" />
                )}
              </div>
              <div className="mt-2.5">
                <TabSwitch tab={tab} onTab={onTab} membersDot={membersDot} compact />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
