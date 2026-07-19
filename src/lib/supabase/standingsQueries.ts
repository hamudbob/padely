import { supabase } from "./client";
import {
  computeStandings,
  CompletedMatchResult,
  AdjustmentEntry,
  RankingBasis,
  StandingRow,
} from "../scoring/standings";

export interface StandingsRow extends StandingRow {
  playerName: string;
  /** Team Sparring only — which fixed side this player is on; null for every other format. */
  teamSide: "A" | "B" | null;
}

export interface SessionStandings {
  rankingBasis: RankingBasis;
  rows: StandingsRow[];
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
    supabase.from("sessions").select("ranking_basis, format, fixed_partner_style").eq("id", sessionId).single(),
    supabase.from("players").select("id, display_name, team_side").eq("session_id", sessionId).eq("status", "active"),
    supabase.from("rounds").select("id").eq("session_id", sessionId),
    supabase.from("adjustments").select("player_id, pair_id, amount").eq("session_id", sessionId),
  ]);
  if (sessionError) throw sessionError;
  if (playersError) throw playersError;
  if (roundsError) throw roundsError;
  if (adjustmentsError) throw adjustmentsError;

  // Fixed Partner: partners are locked for the whole session, so standings
  // should show one row per PAIR (e.g. "Hamud & Said"), not one row per
  // individual player — even though the two partners always carry identical
  // underlying stats (see roundActions.ts's comment on why), showing them as
  // two separate rows would be confusing and redundant. format === "fixed_partner"
  // is kept for backward compat with pre-rework session rows.
  const isFixedPartner = session.fixed_partner_style !== null || session.format === "fixed_partner";

  const activePlayerIds = (players ?? []).map((p) => p.id);
  const nameById = new Map((players ?? []).map((p) => [p.id, p.display_name]));
  const teamSideById = new Map((players ?? []).map((p) => [p.id, p.team_side]));
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

  // Maps a player id to their pair id, and a pair id to its display label
  // ("FirstName & FirstName" — deliberately full names here, unlike the
  // short-initials label pairs.label uses for match-row auto-labeling).
  const pairIdByPlayerId = new Map<string, string>();
  const pairLabelById = new Map<string, string>();
  for (const p of pairsResult.data ?? []) {
    pairIdByPlayerId.set(p.player_a_id, p.id);
    pairIdByPlayerId.set(p.player_b_id, p.id);
    const nameA = nameById.get(p.player_a_id) ?? "?";
    const nameB = nameById.get(p.player_b_id) ?? "?";
    pairLabelById.set(p.id, `${nameA} & ${nameB}`);
  }
  const pairIds = (pairsResult.data ?? []).map((p) => p.id);

  const matchIds = finalMatches.map((m) => m.id);
  const { data: participants, error: participantsError } =
    matchIds.length > 0
      ? await supabase.from("match_participants").select("match_id, player_id, side").in("match_id", matchIds)
      : { data: [], error: null };
  if (participantsError) throw participantsError;

  const participantsByMatch = new Map<string, { player_id: string; side: "A" | "B" }[]>();
  for (const p of participants ?? []) {
    const list = participantsByMatch.get(p.match_id) ?? [];
    list.push({ player_id: p.player_id, side: p.side });
    participantsByMatch.set(p.match_id, list);
  }

  // subjectIds per side: Fixed Partner collapses each side's two player ids
  // down to the ONE pair id they both belong to (a "team" is one pair, not
  // two separately-counted subjects) — every other format passes player ids
  // through unchanged, same as before.
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
    ? (adjustmentRows ?? [])
        .filter((a): a is { player_id: string | null; pair_id: string; amount: number } => a.pair_id !== null)
        .map((a) => ({ subjectId: a.pair_id, amount: a.amount }))
    : (adjustmentRows ?? [])
        .filter((a): a is { player_id: string; pair_id: string | null; amount: number } => a.player_id !== null)
        .map((a) => ({ subjectId: a.player_id, amount: a.amount }));

  const subjectIds = isFixedPartner ? pairIds : activePlayerIds;

  const rows: StandingsRow[] = computeStandings(subjectIds, completedMatches, adjustments, session.ranking_basis).map((r) => ({
    ...r,
    playerName: isFixedPartner ? pairLabelById.get(r.subjectId) ?? "?" : nameById.get(r.subjectId) ?? "?",
    teamSide: isFixedPartner ? null : teamSideById.get(r.subjectId) ?? null,
  }));

  return { rankingBasis: session.ranking_basis, rows };
}
