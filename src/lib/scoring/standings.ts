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
  /** Neutral rest compensation: for every match a subject is short of the
   * highest match count in the field, `restCompensationPerMissedMatch` points
   * are credited so sitting out (or joining late) is neither a reward nor a
   * penalty. Shown as the gold "+N" on the table. Folded into totalPoints. */
  restCompensation: number;
  totalPoints: number; // points + adjustmentTotal + restCompensation — the ONE number everything sorts on
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
  /** Points credited per match a subject is short of the field's max match
   * count (floor(scoreTarget/2) in practice — 2 for best-of-4). Default 0
   * keeps the pure scored-points behaviour. */
  restCompensationPerMissedMatch = 0,
  /** If provided, ONLY these subjects receive rest compensation. Used to keep a
   * player who LEFT on the board with the points they earned, without crediting
   * them for rounds played after they left. Undefined = everyone eligible. */
  compensateOnlyIds?: Set<string>,
): StandingRow[] {
  const base = new Map<string, Omit<StandingRow, "rank" | "totalPoints" | "adjustmentTotal" | "restCompensation">>();
  for (const id of subjectIds) {
    base.set(id, { subjectId: id, points: 0, wins: 0, draws: 0, losses: 0, matchesPlayed: 0 });
  }

  // Head-to-head ledger: the FULL record between each pair of subjects who met
  // directly — { firstWins, secondWins } where "first" is the lexicographically
  // smaller id. Accumulated across every meeting (not last-write-wins), so if X
  // beats Y once and loses once, it's an even h2h — not decided by whoever
  // played most recently.
  const headToHead = new Map<string, { firstWins: number; secondWins: number }>();

  for (const m of matches) {
    for (const id of m.sideA) applyResult(base, id, m.scoreA, m.outcome === "win_a", m.outcome === "draw");
    for (const id of m.sideB) applyResult(base, id, m.scoreB, m.outcome === "win_b", m.outcome === "draw");

    if (m.outcome === "draw") continue; // a draw decides nothing head-to-head
    for (const a of m.sideA) {
      for (const b of m.sideB) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const rec = headToHead.get(key) ?? { firstWins: 0, secondWins: 0 };
        const aIsFirst = a < b;
        const aWon = m.outcome === "win_a";
        // credit the winner of THIS encounter to whichever slot they occupy
        if ((aWon && aIsFirst) || (!aWon && !aIsFirst)) rec.firstWins += 1;
        else rec.secondWins += 1;
        headToHead.set(key, rec);
      }
    }
  }

  const adjTotals = new Map<string, number>();
  for (const adj of adjustments) {
    adjTotals.set(adj.subjectId, (adjTotals.get(adj.subjectId) ?? 0) + adj.amount);
  }

  // Neutral rest compensation is relative to the field's busiest player: a
  // subject who has played `maxMatches - matchesPlayed` fewer games than the
  // leader is credited that many "average games". A late joiner is just a
  // subject with a low matchesPlayed, so they get compensated exactly like a
  // rester — no special-casing needed.
  const maxMatches = subjectIds.reduce((mx, id) => Math.max(mx, base.get(id)!.matchesPlayed), 0);

  const rows: Omit<StandingRow, "rank">[] = subjectIds.map((id) => {
    const b = base.get(id)!;
    const adjustmentTotal = adjTotals.get(id) ?? 0;
    const eligible = !compensateOnlyIds || compensateOnlyIds.has(id);
    const restCompensation = eligible ? Math.max(0, maxMatches - b.matchesPlayed) * restCompensationPerMissedMatch : 0;
    return { ...b, adjustmentTotal, restCompensation, totalPoints: b.points + adjustmentTotal + restCompensation };
  });

  // The tiebreak chain, in the order the host expects for the basis they chose:
  //
  //   points_first   points -> wins -> fewer losses -> head-to-head
  //   wins_first     wins -> fewer losses -> points -> head-to-head
  //
  // Wins-first putting FEWER LOSSES above points is the point of the basis. If
  // points came second, two players level on wins would be separated by margin
  // of victory — which is the points ladder deciding a wins ladder, and the
  // host picked "Wins first" precisely to avoid that. A 5-2 record beats 5-3
  // no matter how heavily the 5-3 won their five.
  //
  // Both chains use the same three keys in a different order, which is why the
  // shared-rank test below can compare the whole chain and stay correct for
  // either basis. Each key returns a number where LOWER sorts first.
  type RankKey = (r: Omit<StandingRow, "rank">) => number;
  const rankKeys: RankKey[] =
    basis === "points_first"
      ? [(r) => -r.totalPoints, (r) => -r.wins, (r) => r.losses]
      : [(r) => -r.wins, (r) => r.losses, (r) => -r.totalPoints];

  rows.sort((x, y) => {
    for (const key of rankKeys) {
      const d = key(x) - key(y);
      if (d !== 0) return d;
    }
    const h2h = headToHeadResult(headToHead, x.subjectId, y.subjectId);
    if (h2h === "x") return -1;
    if (h2h === "y") return 1;
    // Final tiebreak: stable by subjectId, so a tied player's position never
    // "jumps" between rounds just because the field changed (correction:
    // the reference app's volatile ordering is exactly what we're avoiding).
    return x.subjectId < y.subjectId ? -1 : x.subjectId > y.subjectId ? 1 : 0;
  });

  // assign shared ranks: every tiebreak key equal, and no decisive head-to-head
  const result: StandingRow[] = [];
  let rank = 1;
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) {
      const prev = rows[i - 1];
      const cur = rows[i];
      const tied =
        rankKeys.every((key) => key(prev) === key(cur)) &&
        headToHeadResult(headToHead, prev.subjectId, cur.subjectId) === "tie";
      if (!tied) rank = i + 1;
    }
    result.push({ ...rows[i], rank });
  }
  return result;
}

function applyResult(
  base: Map<string, Omit<StandingRow, "rank" | "totalPoints" | "adjustmentTotal" | "restCompensation">>,
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
  ledger: Map<string, { firstWins: number; secondWins: number }>,
  subjectX: string,
  subjectY: string,
): "x" | "y" | "tie" {
  const key = subjectX < subjectY ? `${subjectX}|${subjectY}` : `${subjectY}|${subjectX}`;
  const entry = ledger.get(key);
  if (!entry || entry.firstWins === entry.secondWins) return "tie"; // never met, or an even record → no decisive result (PRD §4)
  const xIsFirst = subjectX < subjectY;
  const firstWonMore = entry.firstWins > entry.secondWins;
  // the pair's "first" (smaller id) won more → they rank ahead
  return firstWonMore === xIsFirst ? "x" : "y";
}
