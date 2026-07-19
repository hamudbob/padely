// Standings computation (PRD §4 Standings, §10 audit). Pure — takes a list of
// completed matches + adjustments, returns a ranked table. Used identically by
// the Host Live "Standings" tab and the Public Live view (same function, same
// result — there's exactly one source of truth for standings, never two
// implementations that could drift apart).

export type RankingBasis = "points_first" | "wins_first";

export interface CompletedMatchResult {
  matchId: string;
  /** Player (or pair, for Fixed Partner/Team Sparring) ids on each side. */
  sideA: string[];
  sideB: string[];
  scoreA: number;
  scoreB: number;
  outcome: "win_a" | "win_b" | "draw";
}

export interface AdjustmentEntry {
  subjectId: string;
  amount: number;
}

export interface StandingRow {
  subjectId: string;
  points: number; // raw scored points/games, excluding adjustments
  adjustmentTotal: number;
  totalPoints: number; // points + adjustmentTotal — what's displayed and sorted on
  wins: number;
  draws: number;
  losses: number;
  matchesPlayed: number;
  rank: number; // 1-based, ties share a rank
}

export function computeStandings(
  subjectIds: string[],
  matches: CompletedMatchResult[],
  adjustments: AdjustmentEntry[],
  basis: RankingBasis,
): StandingRow[] {
  const base = new Map<string, Omit<StandingRow, "rank" | "totalPoints" | "adjustmentTotal">>();
  for (const id of subjectIds) {
    base.set(id, { subjectId: id, points: 0, wins: 0, draws: 0, losses: 0, matchesPlayed: 0 });
  }

  // head-to-head ledger: for each pair of subjects that met directly, who won.
  const headToHead = new Map<string, "a" | "b" | "draw">(); // key = pairKey(subjectA, subjectB) using the order subjectA<subjectB

  for (const m of matches) {
    for (const id of m.sideA) applyResult(base, id, m.scoreA, m.outcome === "win_a", m.outcome === "draw");
    for (const id of m.sideB) applyResult(base, id, m.scoreB, m.outcome === "win_b", m.outcome === "draw");

    // record head-to-head for every sideA-vs-sideB subject pairing in this match
    for (const a of m.sideA) {
      for (const b of m.sideB) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const aIsFirst = a < b;
        const result: "a" | "b" | "draw" =
          m.outcome === "draw" ? "draw" : m.outcome === "win_a" ? (aIsFirst ? "a" : "b") : aIsFirst ? "b" : "a";
        headToHead.set(key, result);
      }
    }
  }

  const adjTotals = new Map<string, number>();
  for (const adj of adjustments) {
    adjTotals.set(adj.subjectId, (adjTotals.get(adj.subjectId) ?? 0) + adj.amount);
  }

  const rows: Omit<StandingRow, "rank">[] = subjectIds.map((id) => {
    const b = base.get(id)!;
    const adjustmentTotal = adjTotals.get(id) ?? 0;
    return { ...b, adjustmentTotal, totalPoints: b.points + adjustmentTotal };
  });

  const primary = (r: Omit<StandingRow, "rank">) => (basis === "points_first" ? r.totalPoints : r.wins);
  const secondary = (r: Omit<StandingRow, "rank">) => (basis === "points_first" ? r.wins : r.totalPoints);

  rows.sort((x, y) => {
    if (primary(y) !== primary(x)) return primary(y) - primary(x);
    if (secondary(y) !== secondary(x)) return secondary(y) - secondary(x);
    const h2h = headToHeadResult(headToHead, x.subjectId, y.subjectId);
    if (h2h === "x") return -1;
    if (h2h === "y") return 1;
    return 0; // genuinely tied -> shared rank, stable order otherwise
  });

  // assign shared ranks: equal (primary, secondary, and no decisive head-to-head) => same rank
  const result: StandingRow[] = [];
  let rank = 1;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const tied =
        primary(prev) === primary(cur) &&
        secondary(prev) === secondary(cur) &&
        headToHeadResult(headToHead, prev.subjectId, cur.subjectId) === "tie";
      if (!tied) rank = i + 1;
    }
    result.push({ ...rows[i], rank });
  }
  return result;
}

function applyResult(
  base: Map<string, Omit<StandingRow, "rank" | "totalPoints" | "adjustmentTotal">>,
  id: string,
  scored: number,
  won: boolean,
  draw: boolean,
) {
  const row = base.get(id);
  if (!row) return; // subject not tracked (e.g. left the session) — skip silently
  row.points += scored;
  row.matchesPlayed += 1;
  if (draw) row.draws += 1;
  else if (won) row.wins += 1;
  else row.losses += 1;
}

function headToHeadResult(
  ledger: Map<string, "a" | "b" | "draw">,
  subjectX: string,
  subjectY: string,
): "x" | "y" | "tie" {
  const key = subjectX < subjectY ? `${subjectX}|${subjectY}` : `${subjectY}|${subjectX}`;
  const entry = ledger.get(key);
  if (!entry || entry === "draw") return "tie"; // "no decisive direct result -> preserve shared rank" (PRD §4)
  const xIsFirst = subjectX < subjectY;
  if (entry === "a") return xIsFirst ? "x" : "y";
  return xIsFirst ? "y" : "x";
}
