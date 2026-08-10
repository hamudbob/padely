import { supabase } from "./client";
import { getProfiles } from "./profileQueries";

/**
 * The club league board (0019/0021 session_results → aggregated here).
 *
 * Everything is derived from the per-session member rows written at each club
 * session's end. A member READS these directly (session_results_read RLS).
 *
 * Scoring (decided design §6.2): each QUALIFYING session (turnout ≥ the club's
 * session_floor) awards placement_points (field_size − rank + 1) + a podium
 * bonus (+3/+2/+1). The league metric is those AVERAGED per session. Only
 * CURRENT club members appear (audit #1), and a player needs ≥ the qualification
 * threshold (which scales with the period, audit #11) to be ranked.
 *
 * Club Score is the shrunk average of the opponent-adjusted per-session
 * performance (perf_adj), on a 0–100 scale (audit #9).
 */

export type LeaguePeriod = "monthly" | "2_month" | "3_month" | "6_month" | "yearly";

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
  periodLabel: string;
  periodStart: string;
  /** Empty-state help: how many club sessions this period met / missed the floor. */
  qualifyingSessions: number;
  totalSessions: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthsInPeriod(period: LeaguePeriod): number {
  switch (period) {
    case "monthly":
      return 1;
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

/** Start of the league period containing `now`, anchored in UTC (audit #19) so a
 * session buckets the same for every viewer regardless of their timezone. */
function periodStartFor(period: LeaguePeriod, now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const block = (size: number) => new Date(Date.UTC(y, Math.floor(m / size) * size, 1));
  switch (period) {
    case "monthly":
      return new Date(Date.UTC(y, m, 1));
    case "2_month":
      return block(2);
    case "3_month":
      return block(3);
    case "6_month":
      return block(6);
    case "yearly":
      return new Date(Date.UTC(y, 0, 1));
    default:
      return new Date(Date.UTC(y, m, 1));
  }
}

function periodEndFor(period: LeaguePeriod, start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthsInPeriod(period), 1));
}

function periodLabelFor(period: LeaguePeriod, start: Date): string {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  switch (period) {
    case "monthly":
      return `${MONTHS[m]} ${y}`;
    case "2_month":
      return `${MONTHS[m]}–${MONTHS[m + 1]} ${y}`;
    case "3_month":
      return `Q${Math.floor(m / 3) + 1} ${y}`;
    case "6_month":
      return `${m === 0 ? "H1" : "H2"} ${y}`;
    case "yearly":
      return `${y}`;
    default:
      return `${y}`;
  }
}

/** A reference date inside the period `offset` periods away from the one holding
 * `now` (offset −1 = previous period). Used by the board's period navigation. */
export function shiftPeriodReference(period: LeaguePeriod, now: Date, offset: number): Date {
  const start = periodStartFor(period, now);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset * monthsInPeriod(period), 1));
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

export async function getClubLeague(clubId: string, reference: Date = new Date()): Promise<LeagueBoard> {
  const { data: club, error: clubError } = await supabase
    .from("clubs")
    .select("session_floor, league_period, league_min_sessions")
    .eq("id", clubId)
    .single();
  if (clubError) throw clubError;

  const period = (club?.league_period ?? "monthly") as LeaguePeriod;
  // A player now appears on the league table after a SINGLE session — clubs
  // that play weekly shouldn't wait a month for a table (was league_min_sessions,
  // typically 3). Kept as a named value so the empty-state copy still reads well.
  const minSessions = 1;
  const start = periodStartFor(period, reference);
  const end = periodEndFor(period, start);

  const [{ data: results, error: resultsError }, { data: memberRows, error: memberError }, { data: countingRows, error: countingError }] =
    await Promise.all([
      supabase
        .from("session_results")
        .select("user_id, session_id, rank, field_size, player_count, placement_points, podium_bonus, wins, perf_adj")
        .eq("club_id", clubId)
        .gte("session_date", start.toISOString())
        .lt("session_date", end.toISOString()),
      supabase.from("club_members").select("user_id").eq("club_id", clubId),
      // Which of this club's sessions count toward the league — the host's
      // per-session "Count for league" choice (replaces the old N-player floor).
      supabase.from("sessions").select("id").eq("club_id", clubId).eq("counts_for_league", true),
    ]);
  if (resultsError) throw resultsError;
  if (memberError) throw memberError;
  if (countingError) throw countingError;

  const memberSet = new Set((memberRows ?? []).map((m) => m.user_id));
  const countingSet = new Set((countingRows ?? []).map((s) => s.id));

  // Session-level turnout tallies for the empty-state help.
  const qualifyingSessionIds = new Set<string>();
  const allSessionIds = new Set<string>();

  const byUser = new Map<string, Agg>();
  for (const r of results ?? []) {
    allSessionIds.add(r.session_id);
    if (countingSet.has(r.session_id)) qualifyingSessionIds.add(r.session_id);
    // Only sessions the host marked "count for league" award points, and only
    // CURRENT members are ranked.
    if (!countingSet.has(r.session_id)) continue;
    if (!memberSet.has(r.user_id)) continue;
    const a = byUser.get(r.user_id) ?? { sessions: 0, totalPoints: 0, wins: 0, perfSum: 0, firsts: 0, rankSum: 0 };
    a.sessions += 1;
    a.totalPoints += r.placement_points + r.podium_bonus;
    a.wins += r.wins;
    a.perfSum += typeof r.perf_adj === "number" ? r.perf_adj : 0.5;
    if (r.rank === 1) a.firsts += 1;
    a.rankSum += r.rank;
    byUser.set(r.user_id, a);
  }

  const profiles = await getProfiles([...byUser.keys()]);

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

  return {
    rows,
    belowThreshold,
    minSessions,
    period,
    periodLabel: periodLabelFor(period, start),
    periodStart: start.toISOString(),
    qualifyingSessions: qualifyingSessionIds.size,
    totalSessions: allSessionIds.size,
  };
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
