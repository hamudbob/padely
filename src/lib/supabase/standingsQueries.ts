import { supabase } from "./client";
import {
  computeStandings,
  CompletedMatchResult,
  AdjustmentEntry,
  RankingBasis,
  StandingRow,
} from "../scoring/standings";
import { scoreRangeForFormat, ScoringFormat } from "../scoring/formats";

export interface StandingsRow extends StandingRow {
  playerName: string;
  /** Team Sparring only — which fixed side this player is on; null for every other format. */
  teamSide: "A" | "B" | null;
  /** Points total + neutral rest compensation: for every match a subject is
   * short of the highest match count in the session, floor(gameTarget/2)
   * points are added — so resting more (and thus playing fewer games) is not
   * a scoreboard penalty. Equals totalPoints when everyone played the same
   * number of games (no-op when the field is balanced). */
  compensatedPoints: number;
  /** Raw points ÷ matches played — the "Point avg" sort. 0 when no matches. */
  pointAvg: number;
  /** Wins ÷ matches played, 0..1 — the "Win %" sort. 0 when no matches. */
  winPct: number;
}

export interface SessionStandings {
  rankingBasis: RankingBasis;
  rows: StandingsRow[];
}

/**
 * Raw per-session rows needed to build standings, already fetched. Kept as a
 * separate input type so the SAME assembly can run from a single-session fetch
 * (getSessionStandings) OR from one batched fetch across many sessions (the
 * home screen's finishing-place). One grouping implementation → the home
 * placement and the Standings tab can never disagree.
 */
export interface StandingsInput {
  session: { ranking_basis: RankingBasis; format: string; fixed_partner_style: string | null; scoring_format: string };
  players: { id: string; display_name: string; team_side: "A" | "B" | null; status: string }[];
  /** Only matches with status === "final" — the caller filters. */
  finalMatches: { id: string; score_a: number | null; score_b: number | null; outcome: string | null; status: string }[];
  participants: { match_id: string; player_id: string; side: "A" | "B" }[];
  adjustments: { player_id: string | null; pair_id: string | null; amount: number }[];
  /** Fixed Partner only; [] otherwise. */
  pairs: { id: string; player_a_id: string; player_b_id: string }[];
}

/**
 * Pure standings assembly from already-fetched rows. No I/O — every DB round
 * trip happens in the caller. This is the one place the compensated-points
 * ranking is turned into a ranked table (see getSessionStandings for the
 * per-session fetch, hostHomeQueries for the batched one).
 */
export function assembleStandings(input: StandingsInput): SessionStandings {
  const { session, players, finalMatches, participants, adjustments: adjustmentRows, pairs } = input;

  const isFixedPartner = session.fixed_partner_style !== null || session.format === "fixed_partner";

  // Someone who was marked "not here yet" and never made it onto a court is
  // not a result — they're an absence. Left in, they'd be ranked on rest
  // compensation alone (which is credited to everyone short of the busiest
  // player), so a no-show could finish mid-table on points they were given for
  // rounds they weren't at. That was harmless while the roster was typed in by
  // hand on the night; it stops being harmless now that RSVPs seed the roster
  // in advance and the host marks the absentees.
  //
  // A player who played even one game and then left is a different case
  // entirely: they took part, they keep their points, and they are still
  // compensated for what they missed.
  const everPlayed = new Set(participants.map((pt) => pt.player_id));
  const activePlayerIds = players
    .filter((p) => p.status !== "left" || everPlayed.has(p.id))
    .map((p) => p.id);
  const nameById = new Map(players.map((p) => [p.id, p.display_name]));
  const teamSideById = new Map(players.map((p) => [p.id, p.team_side]));

  const pairIdByPlayerId = new Map<string, string>();
  const pairLabelById = new Map<string, string>();
  for (const p of pairs) {
    pairIdByPlayerId.set(p.player_a_id, p.id);
    pairIdByPlayerId.set(p.player_b_id, p.id);
    const nameA = nameById.get(p.player_a_id) ?? "?";
    const nameB = nameById.get(p.player_b_id) ?? "?";
    pairLabelById.set(p.id, `${nameA} & ${nameB}`);
  }
  const pairIds = pairs.map((p) => p.id);

  const participantsByMatch = new Map<string, { player_id: string; side: "A" | "B" }[]>();
  for (const p of participants) {
    const list = participantsByMatch.get(p.match_id) ?? [];
    list.push({ player_id: p.player_id, side: p.side });
    participantsByMatch.set(p.match_id, list);
  }

  function subjectIdsForSide(playerIds: string[]): string[] {
    if (!isFixedPartner) return playerIds;
    const uniquePairIds = new Set(playerIds.map((id) => pairIdByPlayerId.get(id)).filter((id): id is string => !!id));
    return [...uniquePairIds];
  }

  const completedMatches: CompletedMatchResult[] = finalMatches
    .filter((m) => m.outcome && m.outcome !== "cancelled")
    .map((m) => {
      const parts = participantsByMatch.get(m.id) ?? [];
      return {
        matchId: m.id,
        sideA: subjectIdsForSide(parts.filter((p) => p.side === "A").map((p) => p.player_id)),
        sideB: subjectIdsForSide(parts.filter((p) => p.side === "B").map((p) => p.player_id)),
        scoreA: m.score_a ?? 0,
        scoreB: m.score_b ?? 0,
        outcome: m.outcome as "win_a" | "win_b" | "draw",
      };
    });

  const adjustments: AdjustmentEntry[] = isFixedPartner
    ? adjustmentRows
        .filter((a): a is { player_id: string | null; pair_id: string; amount: number } => a.pair_id !== null)
        .map((a) => ({ subjectId: a.pair_id, amount: a.amount }))
    : adjustmentRows
        .filter((a): a is { player_id: string; pair_id: string | null; amount: number } => a.player_id !== null)
        .map((a) => ({ subjectId: a.player_id, amount: a.amount }));

  const subjectIds = isFixedPartner ? pairIds : activePlayerIds;

  const neutralRestPoints = Math.floor(scoreRangeForFormat(session.scoring_format as ScoringFormat).max / 2);
  // Rest compensation is credited to EVERY subject who is short of the field's
  // highest match count — including players who LEFT early. A leaver keeps the
  // points they actually earned AND is topped up by floor(gameTarget/2) for
  // every game they missed after leaving, so stepping out is never a scoreboard
  // penalty. This is points-only: no phantom wins or losses are added (W/L come
  // solely from applyResult on real matches). Applies to every format that has
  // a "left" option; passing no compensateOnlyIds set means "compensate all".
  const computed = computeStandings(
    subjectIds,
    completedMatches,
    adjustments,
    session.ranking_basis,
    neutralRestPoints,
  );

  const rows: StandingsRow[] = computed.map((r) => ({
    ...r,
    playerName: isFixedPartner ? pairLabelById.get(r.subjectId) ?? "?" : nameById.get(r.subjectId) ?? "?",
    teamSide: isFixedPartner ? null : teamSideById.get(r.subjectId) ?? null,
    compensatedPoints: r.totalPoints,
    pointAvg: r.matchesPlayed > 0 ? r.points / r.matchesPlayed : 0,
    winPct: r.matchesPlayed > 0 ? r.wins / r.matchesPlayed : 0,
  }));

  return { rankingBasis: session.ranking_basis, rows };
}

/**
 * Live standings across the WHOLE session (every finalized match in every
 * round, not just the current one) — correction #7: "ranking should be able
 * to see all throughout the session, can be sort by win or point." Uses the
 * exact same computeStandings() the Public Live view will use later, so the
 * two screens can never disagree on who's actually winning.
 */
export async function getSessionStandings(sessionId: string): Promise<SessionStandings> {
  // session/players/rounds/adjustments are all independent of each other
  // (none needs another's result) — one parallel batch instead of four
  // sequential round trips. Fires after every score save and every
  // Standings-tab open, so this matters a lot for perceived lag.
  const [
    { data: session, error: sessionError },
    { data: players, error: playersError },
    { data: rounds, error: roundsError },
    { data: adjustmentRows, error: adjustmentsError },
  ] = await Promise.all([
    supabase.from("sessions").select("ranking_basis, format, fixed_partner_style, scoring_format").eq("id", sessionId).single(),
    // ALL players, including those who left — a player who leaves keeps the
    // points they earned on the board (they used to vanish entirely) AND is
    // rest-compensated for the games they missed after leaving, just like a
    // player who sat out to rest. `status` is still read so left players can be
    // labelled in the UI.
    supabase.from("players").select("id, display_name, team_side, status").eq("session_id", sessionId),
    supabase.from("rounds").select("id").eq("session_id", sessionId),
    supabase.from("adjustments").select("player_id, pair_id, amount").eq("session_id", sessionId),
  ]);
  if (sessionError) throw sessionError;
  if (playersError) throw playersError;
  if (roundsError) throw roundsError;
  if (adjustmentsError) throw adjustmentsError;
  if (!session) throw new Error("Session not found.");

  // Fixed Partner: partners are locked for the whole session, so standings
  // should show one row per PAIR (e.g. "Hamud & Said"), not one row per
  // individual player — even though the two partners always carry identical
  // underlying stats (see roundActions.ts's comment on why), showing them as
  // two separate rows would be confusing and redundant. format === "fixed_partner"
  // is kept for backward compat with pre-rework session rows.
  const isFixedPartner = session.fixed_partner_style !== null || session.format === "fixed_partner";
  const roundIds = (rounds ?? []).map((r) => r.id);

  // pairs (Fixed Partner only) and matches (needs roundIds) don't depend on
  // each other — fetch together rather than one after the other. Each is
  // wrapped in a small async helper with an explicit return type so TS
  // checks it against that annotation directly, rather than reconciling two
  // differently-shaped inline expressions inside the same Promise.all slot.
  async function fetchPairs(): Promise<{ data: { id: string; player_a_id: string; player_b_id: string }[]; error: unknown }> {
    if (!isFixedPartner) return { data: [], error: null };
    const { data, error } = await supabase.from("pairs").select("id, player_a_id, player_b_id").eq("session_id", sessionId);
    return { data: data ?? [], error };
  }
  async function fetchFinalMatches(): Promise<{
    data: { id: string; score_a: number | null; score_b: number | null; outcome: string | null; status: string }[];
    error: unknown;
  }> {
    if (roundIds.length === 0) return { data: [], error: null };
    const { data, error } = await supabase
      .from("matches")
      .select("id, score_a, score_b, outcome, status")
      .in("round_id", roundIds)
      .eq("status", "final");
    return { data: data ?? [], error };
  }

  const [pairsResult, matchesResult] = await Promise.all([fetchPairs(), fetchFinalMatches()]);
  if (pairsResult.error) throw pairsResult.error;
  if (matchesResult.error) throw matchesResult.error;
  const finalMatches = matchesResult.data;

  const matchIds = finalMatches.map((m) => m.id);
  const { data: participants, error: participantsError } =
    matchIds.length > 0
      ? await supabase.from("match_participants").select("match_id, player_id, side").in("match_id", matchIds)
      : { data: [], error: null };
  if (participantsError) throw participantsError;

  // Compensation, Fixed-Partner collapsing, tiebreakers etc. all live in
  // assembleStandings so this fetch path and the batched home-screen path share
  // exactly one implementation — table and courts can never disagree.
  return assembleStandings({
    session,
    players: players ?? [],
    finalMatches,
    participants: (participants ?? []) as StandingsInput["participants"],
    adjustments: (adjustmentRows ?? []) as StandingsInput["adjustments"],
    pairs: pairsResult.data ?? [],
  });
}
