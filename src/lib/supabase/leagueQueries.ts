import { supabase } from "./client";
import { getProfiles } from "./profileQueries";
import { SeasonLength, SeasonRule, normaliseRules, seasonsUpTo, pendingRule } from "../league/seasons";

/**
 * The club league board (0019/0021 session_results → aggregated here).
 *
 * Everything is derived from the per-session member rows written at each club
 * session's end. A member READS these directly (session_results_read RLS).
 *
 * Scoring (decided design §6.2): each QUALIFYING session (turnout ≥ the club's
 * session_floor) awards placement_points (field_size − rank + 1) + a podium
 * bonus (+3/+2/+1). The league metric is those AVERAGED per session. Only
 * CURRENT club members appear on the live table (audit #1), and a player needs
 * the club's minimum number of nights (0079) to be ranked. Periods are
 * seasons since Nov 2026 (lib/league/seasons.ts).
 *
 * Club Score is the shrunk average of the opponent-adjusted per-session
 * performance (perf_adj), on a 0–100 scale (audit #9).
 */

export type LeaguePeriod = SeasonLength;

export interface LeagueRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  sessions: number;
  totalPoints: number;
  pointsPerSession: number;
  wins: number;
  winsPerSession: number;
  clubScore: number;
  rating: number;
  // Tiebreak inputs (also surfaced so the UI can sort deterministically).
  firsts: number;
  avgRank: number;
}

export interface LeagueBoard {
  rows: LeagueRow[];
  belowThreshold: number;
  minSessions: number;
  period: LeaguePeriod;
  /** "Season 3 · Oct–Dec 2026". */
  periodLabel: string;
  periodStart: string;
  /** 0 = the season in progress, -1 the one before, … */
  offset: number;
  /** How many seasons there are to page back through (including this one). */
  seasonCount: number;
  /** A change of length an admin has planned, starting next season. */
  pendingChange: { length: SeasonLength; startsAt: string } | null;
  /** Empty-state help: how many club sessions this period met / missed the floor. */
  qualifyingSessions: number;
  totalSessions: number;
}

interface ResultRow {
  user_id: string;
  session_id: string;
  session_date: string;
  rank: number;
  field_size: number;
  player_count: number;
  placement_points: number;
  podium_bonus: number;
  wins: number;
  perf_adj: number | null;
}

interface Agg {
  sessions: number;
  totalPoints: number;
  wins: number;
  perfSum: number;
  firsts: number;
  rankSum: number;
}

const CLUB_SCORE_K = 3;

/** The club's season rules (0079). Before 0079 is applied: none, and the
 *  club's league_period stands in for the one rule. */
export async function getSeasonRules(clubId: string, fallback: SeasonLength): Promise<SeasonRule[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("club_season_rules")
    .select("starts_at, length")
    .eq("club_id", clubId)
    .order("starts_at", { ascending: true });
  const rows = (error ? [] : data ?? []) as { starts_at: string; length: SeasonLength }[];
  return normaliseRules(
    rows.map((r) => ({ startsAt: new Date(r.starts_at), length: r.length })),
    fallback,
  );
}

/** The date of the club's first league night, which is what Season 1 counts from. */
async function firstLeagueNight(clubId: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from("session_results")
    .select("session_date")
    .eq("club_id", clubId)
    .order("session_date", { ascending: true })
    .limit(1);
  if (error) throw error;
  const d = (data ?? [])[0]?.session_date;
  return d ? new Date(d) : null;
}

async function clubLeagueBasics(clubId: string) {
  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .select("league_period, league_min_sessions")
    .eq("id", clubId)
    .single();
  if (clubError) throw clubError;
  const fallback = ((club?.league_period as SeasonLength | undefined) ?? "monthly") as SeasonLength;
  const [rules, first, counting] = await Promise.all([
    getSeasonRules(clubId, fallback),
    firstLeagueNight(clubId),
    // Which of this club's sessions count toward the league — the host's
    // per-session "Count for league" choice (replaces the old N-player floor).
    //
    // Through the RPC, NOT a direct read of `sessions`. 0021 dropped the
    // members' SELECT policy on that table, so a direct read returns zero
    // rows for anyone who didn't host — silently, because RLS denies by
    // returning nothing rather than erroring. Every member but the host saw
    // an empty league table. get_club_sessions is the members' door in, and
    // 0038 taught it to return counts_for_league.
    supabase.rpc("get_club_sessions", { p_club_id: clubId }),
  ]);
  if (counting.error) throw counting.error;
  const countingSet = new Set(
    ((counting.data ?? []) as { id: string; counts_for_league: boolean | null }[])
      .filter((s) => s.counts_for_league !== false)
      .map((s) => s.id),
  );
  // Since 0079 the club sets this (1 by default, which is what the app used
  // since Sep 2026: weekly clubs shouldn't wait a month for a table).
  const minSessions = Math.max(1, Number(club?.league_min_sessions ?? 1) || 1);
  return { rules, first, countingSet, minSessions };
}

/**
 * The table for one set of results. `members` limits it to current members
 * (the live table); null keeps everyone who played (a finished season's
 * podium: a title stays a title when someone later leaves the club).
 */
function tableFrom(
  results: ResultRow[],
  countingSet: Set<string>,
  members: Set<string> | null,
  minSessions: number,
  profiles: Map<string, { displayName: string; avatarUrl: string | null; rating?: number }>,
): { rows: LeagueRow[]; belowThreshold: number; qualifying: number; total: number } {
  const qualifyingSessionIds = new Set<string>();
  const allSessionIds = new Set<string>();
  const byUser = new Map<string, Agg>();
  for (const r of results) {
    allSessionIds.add(r.session_id);
    if (countingSet.has(r.session_id)) qualifyingSessionIds.add(r.session_id);
    // Only sessions the host marked "count for league" award points.
    if (!countingSet.has(r.session_id)) continue;
    if (members && !members.has(r.user_id)) continue;
    const a = byUser.get(r.user_id) ?? { sessions: 0, totalPoints: 0, wins: 0, perfSum: 0, firsts: 0, rankSum: 0 };
    a.sessions += 1;
    a.totalPoints += r.placement_points + r.podium_bonus;
    a.wins += r.wins;
    a.perfSum += typeof r.perf_adj === "number" ? r.perf_adj : 0.5;
    if (r.rank === 1) a.firsts += 1;
    a.rankSum += r.rank;
    byUser.set(r.user_id, a);
  }

  const rows: LeagueRow[] = [];
  let belowThreshold = 0;
  for (const [userId, a] of byUser) {
    if (a.sessions < minSessions) {
      belowThreshold += 1;
      continue;
    }
    const prof = profiles.get(userId);
    const avgPerf = a.perfSum / a.sessions;
    const shrunk = (a.sessions / (a.sessions + CLUB_SCORE_K)) * avgPerf + (CLUB_SCORE_K / (a.sessions + CLUB_SCORE_K)) * 0.5;
    rows.push({
      userId,
      displayName: prof?.displayName ?? "Player",
      avatarUrl: prof?.avatarUrl ?? null,
      sessions: a.sessions,
      totalPoints: a.totalPoints,
      pointsPerSession: a.totalPoints / a.sessions,
      wins: a.wins,
      winsPerSession: a.wins / a.sessions,
      clubScore: Math.round(100 * shrunk),
      rating: prof?.rating ?? 1500,
      firsts: a.firsts,
      avgRank: a.rankSum / a.sessions,
    });
  }
  // Default order: league trophy metric, with the decided tiebreak chain
  // (most 1st-place finishes → better average rank → more sessions → name).
  // True head-to-head (§0.3 step 1) needs match data that isn't in the league
  // feed, so it's omitted here.
  rows.sort(compareByPointsPerSession);
  return { rows, belowThreshold, qualifying: qualifyingSessionIds.size, total: allSessionIds.size };
}

const RESULT_COLUMNS = "user_id, session_id, session_date, rank, field_size, player_count, placement_points, podium_bonus, wins, perf_adj";

/**
 * The league table for one season. `offset` 0 is the season in progress,
 * -1 the one before it, and so on; paging past the club's first season
 * stays on Season 1.
 */
export async function getClubLeague(clubId: string, offset = 0, now: Date = new Date()): Promise<LeagueBoard> {
  const { rules, first, countingSet, minSessions } = await clubLeagueBasics(clubId);
  const seasons = seasonsUpTo(rules, first, now);
  const index = Math.max(0, Math.min(seasons.length - 1, seasons.length - 1 + Math.min(0, offset)));
  const season = seasons[index];

  const [{ data: results, error: resultsError }, { data: memberRows, error: memberError }] = await Promise.all([
    supabase
      .from("session_results")
      .select(RESULT_COLUMNS)
      .eq("club_id", clubId)
      .gte("session_date", season.start.toISOString())
      .lt("session_date", season.end.toISOString()),
    supabase.from("club_members").select("user_id").eq("club_id", clubId),
  ]);
  if (resultsError) throw resultsError;
  if (memberError) throw memberError;

  const memberSet = new Set((memberRows ?? []).map((m) => m.user_id));
  const rows = (results ?? []) as ResultRow[];
  const profiles = await getProfiles([...new Set(rows.map((r) => r.user_id))]);
  const table = tableFrom(rows, countingSet, memberSet, minSessions, profiles);
  const pending = pendingRule(rules, now);

  return {
    rows: table.rows,
    belowThreshold: table.belowThreshold,
    minSessions,
    period: season.length,
    periodLabel: season.label,
    periodStart: season.start.toISOString(),
    offset: index - (seasons.length - 1),
    seasonCount: seasons.length,
    pendingChange: pending ? { length: pending.length, startsAt: pending.startsAt.toISOString() } : null,
    qualifyingSessions: table.qualifying,
    totalSessions: table.total,
  };
}

export interface SeasonPodium {
  label: string;
  number: number;
  dates: string;
  start: string;
  /** Up to three, champion first. */
  podium: LeagueRow[];
  nights: number;
}

export interface LeagueHistory {
  /** Finished seasons, newest first. */
  finished: SeasonPodium[];
  /** The season in progress, with its leaders so far. */
  current: SeasonPodium | null;
  /** League titles per player, most first. */
  titles: { userId: string; displayName: string; avatarUrl: string | null; titles: number; podiums: number }[];
}

/** Every season's top three, for the Champions Hall League tab. */
export async function getClubLeagueHistory(clubId: string, now: Date = new Date()): Promise<LeagueHistory> {
  const { rules, first, countingSet, minSessions } = await clubLeagueBasics(clubId);
  const seasons = seasonsUpTo(rules, first, now);
  const { data, error } = await supabase.from("session_results").select(RESULT_COLUMNS).eq("club_id", clubId);
  if (error) throw error;
  const all = (data ?? []) as ResultRow[];
  const profiles = await getProfiles([...new Set(all.map((r) => r.user_id))]);

  const bySeason = (s: (typeof seasons)[number]) =>
    all.filter((r) => {
      const t = Date.parse(r.session_date);
      return t >= s.start.getTime() && t < s.end.getTime();
    });

  const podiums: SeasonPodium[] = seasons.map((s) => {
    const rows = bySeason(s);
    const table = tableFrom(rows, countingSet, null, minSessions, profiles);
    return { label: s.label, number: s.number, dates: s.dates, start: s.start.toISOString(), podium: table.rows.slice(0, 3), nights: table.qualifying };
  });

  const currentSeason = seasons[seasons.length - 1];
  const finished = podiums.filter((p, i) => seasons[i].end.getTime() <= now.getTime() && p.podium.length > 0).reverse();
  const current = currentSeason && currentSeason.end.getTime() > now.getTime() ? podiums[podiums.length - 1] : null;

  const tally = new Map<string, { userId: string; displayName: string; avatarUrl: string | null; titles: number; podiums: number }>();
  for (const p of finished) {
    p.podium.forEach((r, i) => {
      const t = tally.get(r.userId) ?? { userId: r.userId, displayName: r.displayName, avatarUrl: r.avatarUrl, titles: 0, podiums: 0 };
      if (i === 0) t.titles += 1;
      t.podiums += 1;
      tally.set(r.userId, t);
    });
  }
  const titles = [...tally.values()]
    .filter((t) => t.titles > 0)
    .sort((a, b) => b.titles - a.titles || b.podiums - a.podiums || a.displayName.localeCompare(b.displayName));

  return { finished, current, titles };
}

function compareByPointsPerSession(x: LeagueRow, y: LeagueRow): number {
  return (
    y.pointsPerSession - x.pointsPerSession ||
    y.firsts - x.firsts ||
    x.avgRank - y.avgRank ||
    y.sessions - x.sessions ||
    x.displayName.localeCompare(y.displayName)
  );
}
