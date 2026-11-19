import { BADGES, BadgeDef, CLUB_BADGES, PLAYER_BADGES } from "./catalog";

/** One row of player_badges, as get_badges returns it. */
export interface EarnedBadge {
  clubId: string | null;
  badge: string;
  level: number;
  earnedAt: string;
  sessionId: string | null;
  detail: Record<string, unknown> | null;
}

export interface BadgeProgressRow {
  clubId: string | null;
  badge: string;
  value: number;
  detail: Record<string, unknown> | null;
}

export interface BadgeClub {
  id: string;
  name: string;
  logoUrl: string | null;
  /** This person owns it (Founder can only be theirs). */
  owner: boolean;
}

export interface BadgesData {
  earned: EarnedBadge[];
  progress: BadgeProgressRow[];
  clubs: BadgeClub[];
  /** Someone, anywhere, has reached the top tier (its name shows from then on). */
  eliteSeen: boolean;
}

/** How a badge is drawn: not yet, first level, in between, the top. */
export type BadgeStage = "locked" | "first" | "middle" | "top";

export interface BadgeState {
  def: BadgeDef;
  clubId: string | null;
  earned: EarnedBadge[];
  isEarned: boolean;
  /** levels: the highest threshold reached; repeat: how many times; once: 1. */
  level: number | null;
  /** How far along (nights, partners...). */
  count: number;
  /** The next threshold, for "31 of 50". Null at the top or for non-levels. */
  next: number | null;
  stage: BadgeStage;
  lastEarnedAt: string | null;
}

const key = (clubId: string | null, badge: string) => `${clubId ?? ""}|${badge}`;

export function badgeState(def: BadgeDef, clubId: string | null, data: BadgesData): BadgeState {
  const earned = data.earned
    .filter((e) => e.badge === def.id && (e.clubId ?? null) === clubId)
    .sort((a, b) => a.level - b.level);
  const progress = data.progress.find((p) => key(p.clubId ?? null, p.badge) === key(clubId, def.id));
  const count = progress?.value ?? 0;
  const isEarned = earned.length > 0;
  const lastEarnedAt = isEarned ? earned.reduce((m, e) => (e.earnedAt > m ? e.earnedAt : m), earned[0].earnedAt) : null;

  if (def.kind === "levels" && def.levels) {
    const level = isEarned ? earned[earned.length - 1].level : null;
    const idx = level === null ? -1 : def.levels.indexOf(level);
    const next = def.levels.find((l) => l > (level ?? 0)) ?? null;
    const stage: BadgeStage = idx < 0 ? "locked" : idx === def.levels.length - 1 ? "top" : idx === 0 ? "first" : "middle";
    return { def, clubId, earned, isEarned, level, count, next, stage, lastEarnedAt };
  }
  if (def.kind === "repeat") {
    const level = isEarned ? earned.length : null;
    return { def, clubId, earned, isEarned, level, count, next: null, stage: isEarned ? "middle" : "locked", lastEarnedAt };
  }
  return { def, clubId, earned, isEarned, level: isEarned ? 1 : null, count, next: null, stage: isEarned ? "top" : "locked", lastEarnedAt };
}

export interface ClubShelf {
  club: BadgeClub;
  badges: BadgeState[];
  earnedCount: number;
}

export interface Shelf {
  tiers: BadgeState[];
  player: BadgeState[];
  clubs: ClubShelf[];
  /** Distinct badges earned (a badge with three levels counts once). */
  earnedCount: number;
  /** All there is to earn for this person: 18, plus 12 a club (11 if not the owner). */
  totalCount: number;
  /** The levelled badge closest to its next level, for "Next up". */
  nextUp: BadgeState | null;
  /** Peak settled rating, for the tiers line. */
  peakRating: number | null;
}

/** Badges for a club this person isn't the owner of leave Founder out, unless
 *  they earned it before the club changed hands. */
export function clubBadgesFor(club: BadgeClub, data: BadgesData): BadgeState[] {
  return CLUB_BADGES.filter((d) => !d.ownerOnly || club.owner || data.earned.some((e) => e.badge === d.id && e.clubId === club.id)).map(
    (d) => badgeState(d, club.id, data),
  );
}

export function buildShelf(data: BadgesData): Shelf {
  const tiers = PLAYER_BADGES.filter((d) => d.kind === "tier").map((d) => badgeState(d, null, data));
  const player = PLAYER_BADGES.filter((d) => d.kind !== "tier").map((d) => badgeState(d, null, data));
  const clubs = data.clubs.map((club) => {
    const badges = clubBadgesFor(club, data);
    return { club, badges, earnedCount: badges.filter((b) => b.isEarned).length };
  });
  const all = [...tiers, ...player, ...clubs.flatMap((c) => c.badges)];
  const candidates = all.filter((b) => b.def.kind === "levels" && b.next !== null && b.count > 0);
  const nextUp =
    candidates.sort((a, b) => b.count / (b.next ?? 1) - a.count / (a.next ?? 1) || (a.next! - a.count) - (b.next! - b.count))[0] ?? null;
  const peak = data.progress.find((p) => p.badge === "peak_rating" && !p.clubId);
  return {
    tiers,
    player,
    clubs,
    earnedCount: all.filter((b) => b.isEarned).length,
    totalCount: all.length,
    nextUp,
    peakRating: peak ? Math.round(peak.value) : null,
  };
}

/** Badges earned on one night (the results screen). Each badge once, at the
 *  highest level that night gave. */
export function earnedOnNight(data: BadgesData, sessionId: string): { state: BadgeState; level: number }[] {
  const tonight = data.earned.filter((e) => e.sessionId === sessionId);
  const seen = new Map<string, EarnedBadge>();
  for (const e of tonight) {
    const k = key(e.clubId ?? null, e.badge);
    const prev = seen.get(k);
    if (!prev || e.level > prev.level) seen.set(k, e);
  }
  return [...seen.values()]
    .map((e) => {
      const def = BADGES.find((d) => d.id === e.badge);
      return def ? { state: badgeState(def, e.clubId ?? null, data), level: e.level } : null;
    })
    .filter((x): x is { state: BadgeState; level: number } => x !== null);
}

/** "25", "×3" or nothing: the little number on a badge. */
export function badgeChip(s: BadgeState): string | null {
  if (!s.isEarned) return s.def.kind === "levels" && s.next ? String(s.next) : null;
  if (s.def.kind === "levels") return String(s.level);
  if (s.def.kind === "repeat" && (s.level ?? 0) > 1) return `×${s.level}`;
  return null;
}

/** What shows under a badge's name on the shelf. */
export function badgeCaption(s: BadgeState, opts: { self: boolean }): string {
  const d = s.def;
  const best = (name: string) => s.earned[0]?.detail?.[name];
  if (d.kind === "levels") {
    // Short enough for a 4-across grid; the sheet spells out the unit.
    if (s.next === null) return `${s.count} ${d.unit}`;
    return `${s.count} of ${s.next}`;
  }
  if (d.kind === "repeat") return s.isEarned ? (s.level === 1 ? "Once" : `${s.level} times`) : "Not yet";
  if (!s.isEarned) return d.kind === "hidden" ? "Keep playing" : "Not yet";
  if (d.id === "rivalry") return opts.self && typeof best("name") === "string" ? `${best("name")} · 20 games` : "20 games, one opponent";
  if (d.id === "giant_slayer" && typeof best("gap") === "number") return `Beat +${best("gap")}`;
  if (d.id === "big_climb" && typeof best("delta") === "number") return `+${best("delta")} in a night`;
  return dayMonth(s.earned[0].earnedAt);
}

export function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}
