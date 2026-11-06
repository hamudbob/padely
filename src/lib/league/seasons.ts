/**
 * Seasons: a club's league, cut into periods (Nov 2026).
 *
 * A season is what the league used to call a "period": monthly, 2, 3 or 6
 * months, or a year. What's new is that the length can change over a club's
 * life. Each change is a RULE: "from this date, seasons are N months long".
 * A change made by an admin always starts at the END of the season in
 * progress (Hamud, 6 Nov 2026), so nobody's standings jump mid-season.
 *
 * The first rule of every club starts on 1 Jan 2000, which makes its seasons
 * line up with the calendar exactly as the old periods did (Q4 = Oct–Dec,
 * H1 = Jan–Jun, ...). A rule added later starts its seasons from its own date:
 * monthly until 30 Nov, then 3 months from 1 Dec, gives Dec–Feb, Mar–May.
 *
 * Everything is in UTC (league audit #19): a night buckets into the same
 * season for every viewer, wherever their phone thinks it is.
 *
 * Pure: no database, so it is tested directly and shared by the league page,
 * the Champions Hall and the club settings screen.
 */

export type SeasonLength = "monthly" | "2_month" | "3_month" | "6_month" | "yearly";

export const SEASON_LENGTHS: { value: SeasonLength; label: string }[] = [
  { value: "monthly", label: "1 month" },
  { value: "2_month", label: "2 months" },
  { value: "3_month", label: "3 months" },
  { value: "6_month", label: "6 months" },
  { value: "yearly", label: "1 year" },
];

export interface SeasonRule {
  /** First day of the first season under this rule (UTC midnight, 1st of a month). */
  startsAt: Date;
  length: SeasonLength;
}

export interface Season {
  start: Date;
  /** Exclusive. */
  end: Date;
  length: SeasonLength;
  /** 1-based, counted from the club's first league night. 0 for a season before it. */
  number: number;
  /** "Nov 2026", "Oct–Dec 2026", "2026", "Dec 2026–Feb 2027". */
  dates: string;
  /** "Season 3 · Oct–Dec 2026". */
  label: string;
}

export const ORIGIN = new Date(Date.UTC(2000, 0, 1));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthsOf(length: SeasonLength): number {
  switch (length) {
    case "2_month":
      return 2;
    case "3_month":
      return 3;
    case "6_month":
      return 6;
    case "yearly":
      return 12;
    default:
      return 1;
  }
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function monthIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Rules sorted, with the origin rule guaranteed first. `fallback` is the club's
 *  current length, used when the club has no rules stored yet. */
export function normaliseRules(rules: SeasonRule[], fallback: SeasonLength): SeasonRule[] {
  const sorted = [...rules].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (sorted.length === 0 || sorted[0].startsAt.getTime() > ORIGIN.getTime()) {
    sorted.unshift({ startsAt: ORIGIN, length: sorted[0]?.length ?? fallback });
  }
  return sorted;
}

function ruleAt(rules: SeasonRule[], at: Date): { rule: SeasonRule; next: SeasonRule | null } {
  let i = 0;
  for (let j = 0; j < rules.length; j++) if (rules[j].startsAt.getTime() <= at.getTime()) i = j;
  return { rule: rules[i], next: rules[i + 1] ?? null };
}

/** The start and end of the season holding `at`. */
export function seasonBounds(rules: SeasonRule[], at: Date): { start: Date; end: Date; length: SeasonLength } {
  const { rule, next } = ruleAt(rules, at);
  const size = monthsOf(rule.length);
  const k = Math.floor((monthIndex(at) - monthIndex(rule.startsAt)) / size);
  const start = addMonths(rule.startsAt, k * size);
  let end = addMonths(start, size);
  if (next && next.startsAt.getTime() < end.getTime()) end = next.startsAt;
  return { start, end, length: rule.length };
}

export function seasonDates(start: Date, end: Date): string {
  const last = addMonths(end, -1);
  const y1 = start.getUTCFullYear();
  const y2 = last.getUTCFullYear();
  const m1 = start.getUTCMonth();
  const m2 = last.getUTCMonth();
  if (monthIndex(start) === monthIndex(last)) return `${MONTHS[m1]} ${y1}`;
  if (y1 === y2 && m1 === 0 && m2 === 11) return `${y1}`;
  if (y1 === y2) return `${MONTHS[m1]}–${MONTHS[m2]} ${y1}`;
  return `${MONTHS[m1]} ${y1}–${MONTHS[m2]} ${y2}`;
}

/**
 * Every season from the one holding the club's first league night up to the
 * one holding `now`, oldest first. With no league night yet, just the season
 * in progress, numbered 1.
 */
export function seasonsUpTo(rules: SeasonRule[], firstNight: Date | null, now: Date): Season[] {
  const from = firstNight && firstNight.getTime() <= now.getTime() ? firstNight : now;
  const out: Season[] = [];
  let cursor = seasonBounds(rules, from).start;
  let n = 1;
  while (cursor.getTime() <= now.getTime() && out.length < 600) {
    const b = seasonBounds(rules, cursor);
    const dates = seasonDates(b.start, b.end);
    out.push({ start: b.start, end: b.end, length: b.length, number: n, dates, label: `Season ${n} · ${dates}` });
    cursor = b.end;
    n++;
  }
  return out;
}

/** The season holding `at`, numbered against the same list. */
export function seasonFor(rules: SeasonRule[], firstNight: Date | null, at: Date): Season {
  const list = seasonsUpTo(rules, firstNight, at);
  return list[list.length - 1];
}

/**
 * What an admin's change of length means: it starts when the season in
 * progress ends. Returns null when nothing would change (the same length as
 * the next season already has).
 */
export function plannedChange(rules: SeasonRule[], now: Date, length: SeasonLength): { startsAt: Date } | null {
  const current = seasonBounds(rules, now);
  const nextLength = ruleAt(rules, current.end).rule.length;
  if (nextLength === length) return null;
  return { startsAt: current.end };
}

/** A change already saved but not started yet, if any. */
export function pendingRule(rules: SeasonRule[], now: Date): SeasonRule | null {
  return rules.find((r) => r.startsAt.getTime() > now.getTime()) ?? null;
}
