import { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * The small parts the club page, its tabs and the Call-up page share (ADR-002,
 * Nov 2026). Soft white cards on ivory, gold for "this is you / this is
 * first", no black cards.
 */

export const card = "rounded-[22px] bg-surface shadow-[0_1px_2px_rgba(13,13,13,0.04)]";
export const raisedCard =
  "rounded-[24px] bg-surface shadow-[0_1px_2px_rgba(13,13,13,0.04),0_10px_26px_-16px_rgba(13,13,13,0.18)]";

/** Soft tints for faces without a photo, picked from the name so a person
 *  keeps the same colour everywhere. */
const TINTS = [
  "bg-gold-soft text-gold-ink",
  "bg-win-soft text-win",
  "bg-loss-soft text-loss",
  "bg-[#EEF0FB] text-[#3D4C9A]",
  "bg-surface-2 text-ink-2",
];
export function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

export function initialOf(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

export function Face({
  name,
  url,
  size = 36,
  gold,
  ring,
}: {
  name: string;
  url?: string | null;
  size?: number;
  /** The winner: solid gold. */
  gold?: boolean;
  /** A gold ring, e.g. the owner. */
  ring?: boolean;
}) {
  const cls = gold ? "bg-gold text-graphite font-serif" : tintFor(name);
  return (
    <span
      className={`rounded-full flex items-center justify-center font-bold overflow-hidden shrink-0 ${cls} ${ring ? "ring-2 ring-gold" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : initialOf(name)}
    </span>
  );
}

/** A segmented switch: light track, the chosen one a white pill. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  small,
  onWarm,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
  /** On the gold band: a translucent white track and gold words. */
  onWarm?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex p-[3px] rounded-full ${onWarm ? "bg-surface/55" : "bg-[#EFEBE4]"}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-full font-semibold transition-colors active:opacity-80 ${small ? "py-1.5 px-3 text-[12px]" : "py-2 text-[12.5px]"} ${
              on ? "bg-surface text-graphite shadow-[0_1px_3px_rgba(13,13,13,0.1)]" : onWarm ? "text-gold-ink" : "text-warm-gray"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function DateTile({ iso, tone = "warm" }: { iso: string; tone?: "warm" | "plain" }) {
  const d = new Date(iso);
  const ok = !Number.isNaN(d.getTime());
  return (
    <span className={`w-[40px] shrink-0 rounded-[12px] text-center py-[5px] ${tone === "warm" ? "bg-gold-soft" : "bg-surface-2"}`} aria-hidden>
      <span className="block text-[8.5px] font-bold tracking-[0.1em] text-gold-ink uppercase">
        {ok ? d.toLocaleDateString(undefined, { weekday: "short" }) : ""}
      </span>
      <span className="block font-serif text-[16px] font-semibold text-graphite leading-none mt-[2px]">{ok ? d.getDate() : "–"}</span>
    </span>
  );
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mt-7 px-0.5">
      <h2 className="font-serif text-[18px] font-semibold text-graphite">{title}</h2>
      {action}
    </div>
  );
}

export interface PodiumEntry {
  key: string;
  name: string;
  avatarUrl: string | null;
  /** The big number on the step. */
  value: string;
  /** Under it: "13.8 / night", "titles · 4 podiums". */
  unit: string;
  href?: string;
}

/** Top three on steps: 2nd, 1st (gold), 3rd. */
export function Podium({ entries }: { entries: PodiumEntry[] }) {
  const [first, second, third] = entries;
  const order: { e: PodiumEntry | undefined; place: 1 | 2 | 3 }[] = [
    { e: second, place: 2 },
    { e: first, place: 1 },
    { e: third, place: 3 },
  ];
  const height = { 1: "h-[66px]", 2: "h-[48px]", 3: "h-[36px]" };
  return (
    <div className="grid grid-cols-3 gap-2 items-end">
      {order.map(({ e, place }) => {
        if (!e) return <span key={place} />;
        const body = (
          <>
            <span className="flex justify-center">
              <Face name={e.name} url={e.avatarUrl} size={place === 1 ? 52 : 42} gold={place === 1 && !e.avatarUrl} ring={place === 1} />
            </span>
            <span className={`block truncate mt-1.5 ${place === 1 ? "text-[12.5px] font-bold" : "text-[12px] font-semibold"} text-graphite`}>{e.name}</span>
            <span
              className={`mt-1.5 flex flex-col items-center justify-center rounded-t-[12px] rounded-b-[4px] ${height[place]} ${
                place === 1 ? "bg-gold-soft" : "bg-surface-2"
              }`}
            >
              <span className={`font-mono tnum font-semibold ${place === 1 ? "text-[17px] text-gold-ink" : "text-[15px] text-graphite"}`}>{e.value}</span>
              <span className={`text-[10px] ${place === 1 ? "text-gold-ink" : "text-warm-gray"}`}>{e.unit}</span>
            </span>
          </>
        );
        return e.href ? (
          <Link key={e.key} to={e.href} className="text-center min-w-0 active:opacity-80">
            {body}
          </Link>
        ) : (
          <div key={e.key} className="text-center min-w-0">
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function Chevron() {
  return (
    <span className="text-stone text-[17px] shrink-0" aria-hidden>
      ›
    </span>
  );
}

export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function CrownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#BFA36A" aria-hidden>
      <path d="M3 18h18l-2-11-4 4-3-6-3 6-4-4z" />
    </svg>
  );
}
