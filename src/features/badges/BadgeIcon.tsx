import { ReactNode } from "react";
import { BadgeIconName } from "../../lib/badges/catalog";
import { BadgeStage, BadgeState, badgeChip } from "../../lib/badges/model";

/**
 * How a badge looks (design canvas, "How a badge looks").
 *
 * A round medal with a line icon. A levelled badge carries its number and gets
 * richer as it climbs: white with a graphite ring at the first level, gold-soft
 * in between, solid gold at the top. One-off badges are solid gold once earned.
 * Not earned yet: a dashed ring and a grey icon; hidden ones show "?".
 * Tiers are hexagons with one, two or three chevrons, kept forever.
 */

const P = (d: string) => <path d={d} />;

const ICONS: Record<BadgeIconName, ReactNode> = {
  tier1: null,
  tier2: null,
  tier3: null,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ),
  racket: (
    <>
      <ellipse cx="10" cy="9" rx="6" ry="6.5" />
      <line x1="14.2" y1="13.6" x2="20" y2="20" />
      <circle cx="18.5" cy="5.5" r="1.6" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="7.5 12.5 10.5 15.5 16.5 9" />
    </>
  ),
  flame: P("M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.2-3.7 2.3-4.8.2 1.6 1 2.6 2.2 2.8-.9-2.6-.4-5.4.5-8z"),
  shield: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z" />
      <polyline points="8.5 12 11 14.5 15.5 9.5" />
    </>
  ),
  zero: (
    <>
      <ellipse cx="12" cy="12" rx="5.5" ry="8" />
      <line x1="8" y1="17.5" x2="16" y2="6.5" />
    </>
  ),
  slingshot: (
    <>
      <path d="M8 21v-7l-4-8" />
      <path d="M8 14l4-8" />
      <path d="M4 6c2 2.5 6 2.5 8 0" />
      <path d="M14 13l6-6M20 7h-4M20 7v4" />
    </>
  ),
  arrowUp: (
    <>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M16 14.2a5 5 0 0 1 5.5 5.8" />
    </>
  ),
  swords: (
    <>
      <path d="M4 4l9 9M4 4h4M4 4v4" />
      <path d="M20 4l-9 9M20 4h-4M20 4v4" />
      <path d="M8 16l-3 3M16 16l3 3M10 14l-2 2M14 14l2 2" />
    </>
  ),
  whistle: (
    <>
      <path d="M3 11a5 5 0 1 0 10 0h8V8H8" />
      <circle cx="8" cy="11" r="1.4" />
      <line x1="11" y1="4" x2="11" y2="6.5" />
    </>
  ),
  moon: P("M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"),
  sunrise: (
    <>
      <path d="M6 17a6 6 0 0 1 12 0" />
      <line x1="3" y1="17" x2="21" y2="17" />
      <line x1="12" y1="4" x2="12" y2="7" />
      <line x1="4.9" y1="9.9" x2="6.6" y2="11.6" />
      <line x1="19.1" y1="9.9" x2="17.4" y2="11.6" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 5 10 5 10 9s-10 4-10 9" />
      <path d="M17 3c0 5-10 5-10 9s10 4 10 9" />
    </>
  ),
  two: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <path d="M9.5 12.5a2.5 2.5 0 1 1 4.3 1.8L9.5 18h5" />
    </>
  ),
  court: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </>
  ),
  star: P("M12 3.5l2.6 5.5 5.9.6-4.5 4 1.3 5.9L12 16.5l-5.3 3 1.3-5.9-4.5-4 5.9-.6z"),
  crown: (
    <>
      <path d="M3.5 8.5l4.2 3.8L12 6l4.3 6.3 4.2-3.8-1.8 9.5H5.3z" />
      <line x1="5.5" y1="21" x2="18.5" y2="21" />
    </>
  ),
  podium: (
    <>
      <rect x="9" y="7" width="6" height="14" />
      <rect x="3" y="12" width="6" height="9" />
      <rect x="15" y="14" width="6" height="7" />
    </>
  ),
  three: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 8.5h5l-2.5 3a2.6 2.6 0 1 1-2.6 3.4" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M17 5.5h3v1.5a3 3 0 0 1-3 3" />
      <path d="M7 5.5H4v1.5a3 3 0 0 0 3 3" />
      <line x1="12" y1="14" x2="12" y2="18" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="9" y1="18" x2="15" y2="18" />
    </>
  ),
  laurel: (
    <>
      <path d="M8 3l2.5 6M16 3l-2.5 6" />
      <circle cx="12" cy="14.5" r="5.5" />
      <path d="M12 12v5M10.5 13l1.5-1" />
    </>
  ),
  repeat: (
    <>
      <polyline points="17 2 21 6 17 10" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <polyline points="7 22 3 18 7 14" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </>
  ),
  flag: (
    <>
      <line x1="5" y1="21" x2="5" y2="4" />
      <path d="M5 4h12l-2.5 4L17 12H5" />
    </>
  ),
  invite: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </>
  ),
  full: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.4" />
      <circle cx="15.5" cy="10" r="1.4" />
      <circle cx="8.5" cy="15" r="1.4" />
      <circle cx="15.5" cy="15" r="1.4" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
};

const RING: Record<BadgeStage, { bg: string; border: string; icon: string }> = {
  locked: { bg: "#F7F5F2", border: "2px dashed #D6D3CE", icon: "#A8A49D" },
  first: { bg: "#FFFFFF", border: "2px solid #D6D3CE", icon: "#141412" },
  middle: { bg: "#F7F0E3", border: "2px solid #BFA36A", icon: "#836529" },
  top: { bg: "#BFA36A", border: "2px solid #BFA36A", icon: "#FFFFFF" },
};

export function TierHex({ tier, earned, unseen, size = 64 }: { tier: 1 | 2 | 3; earned: boolean; unseen?: boolean; size?: number }) {
  const fill = !earned ? "#F7F5F2" : tier === 1 ? "#FFFFFF" : tier === 2 ? "#F7F0E3" : "#141412";
  const stroke = !earned ? "#D6D3CE" : tier === 1 ? "#141412" : "#BFA36A";
  const chev = !earned ? "#A8A49D" : tier === 1 ? "#141412" : tier === 2 ? "#836529" : "#BFA36A";
  const ys = tier === 1 ? [36] : tier === 2 ? [31, 41] : [27, 36, 45];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path
        d="M32 3 L57 17 L57 47 L32 61 L7 47 L7 17 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeDasharray={earned ? undefined : "4 4"}
      />
      {unseen ? (
        <text x="32" y="41" textAnchor="middle" fontFamily="Fraunces, Georgia, serif" fontSize="24" fontWeight="600" fill="#A8A49D">
          ?
        </text>
      ) : (
        ys.map((y) => (
          <polyline
            key={y}
            points={`22 ${y} 32 ${y - 8} 42 ${y}`}
            fill="none"
            stroke={chev}
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))
      )}
    </svg>
  );
}

/** One badge: the medal, or the hexagon for a tier. */
export default function BadgeIcon({
  state,
  size = 60,
  eliteSeen = true,
  stage,
  chip,
}: {
  state: BadgeState;
  size?: number;
  /** Whether the top tier's name may show. */
  eliteSeen?: boolean;
  /** Draw at a given stage instead of the badge's own (a level row in the sheet). */
  stage?: BadgeStage;
  chip?: string | null;
}) {
  const def = state.def;
  if (def.kind === "tier") {
    const tier = def.icon === "tier1" ? 1 : def.icon === "tier2" ? 2 : 3;
    return <TierHex tier={tier} earned={state.isEarned} unseen={tier === 3 && !state.isEarned && !eliteSeen} size={size + 6} />;
  }
  const st = stage ?? state.stage;
  const ring = RING[st];
  const secret = def.kind === "hidden" && !state.isEarned;
  const label = chip === undefined ? badgeChip(state) : chip;
  const iconSize = Math.round(size * 0.44);
  return (
    <span
      className="relative rounded-full flex items-center justify-center shrink-0 box-border"
      style={{ width: size, height: size, background: ring.bg, border: ring.border }}
      aria-hidden
    >
      {secret ? (
        <span className="font-serif font-semibold" style={{ fontSize: Math.round(size * 0.4), color: "#A8A49D" }}>
          ?
        </span>
      ) : (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke={ring.icon}
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICONS[def.icon]}
        </svg>
      )}
      {label && !secret && (
        <span
          className={`absolute -right-1 -bottom-[3px] min-w-[20px] h-5 px-[5px] rounded-full font-mono text-[10.5px] font-semibold flex items-center justify-center shadow-[0_1px_3px_rgba(13,13,13,0.14)] tnum ${
            st === "top" ? "bg-graphite text-surface" : st === "locked" ? "bg-surface text-warm-gray" : "bg-surface text-ink"
          }`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
