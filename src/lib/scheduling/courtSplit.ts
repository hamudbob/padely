// Within-court partner selection, shared by Mexicano and Mix Mexicano.
//
// Given the four players on a court (in rank order, strongest first), decide
// who partners whom. There are only three ways to split four into two pairs:
//
//   A: 1st + 4th  vs  2nd + 3rd   (balanced — equal rank-sum)
//   B: 1st + 3rd  vs  2nd + 4th   (slightly tilted)
//   C: 1st + 2nd  vs  3rd + 4th   (lopsided — top pair vs bottom pair)
//
// We pick the split by a SOFT score, never a hard rule, so it can never fail
// to produce a round:
//   1. fewest repeat PARTNERSHIPS (heaviest weight) — this is what rotates
//      partners round to round instead of sticking you with the same person,
//   2. then fewest repeat OPPONENTS,
//   3. then most balanced (prefer A, then B, then C) so teams stay competitive.
// Ties fall to the earlier (more balanced) option, so it's fully deterministic
// — no random jumping. With no history (round 1) it just returns A.

import { MatchHistory, PlayerId, pairKey } from "./types";

type Split = { teamA: [PlayerId, PlayerId]; teamB: [PlayerId, PlayerId]; imbalance: number };

/**
 * The cost of a repeat grows with the square of how often it has happened:
 * partnering someone a second time costs 100, a third time 400. So the
 * scheduler will always rather give two people their second game together
 * than give one pair its third — and a pair you have never had beats both.
 * (Until Oct 2026 this only asked "seen before, yes or no", so once every
 * option on a court had been seen it could not tell a 2nd repeat from a 4th.)
 */
const PARTNER_WEIGHT = 100;
const OPPONENT_WEIGHT = 10;

function partnerCost(history: MatchHistory | undefined, a: PlayerId, b: PlayerId): number {
  if (!history) return 0;
  const n = history.partnerCounts.get(pairKey(a, b)) ?? (history.partnerPairsSeen.has(pairKey(a, b)) ? 1 : 0);
  return n * n * PARTNER_WEIGHT;
}

function opponentCost(history: MatchHistory | undefined, a: PlayerId, b: PlayerId): number {
  if (!history) return 0;
  const n = history.opponentCounts.get(pairKey(a, b)) ?? (history.opponentPairsSeen.has(pairKey(a, b)) ? 1 : 0);
  return n * OPPONENT_WEIGHT;
}

/** The best split of one court, and what it costs (0 = nothing repeated, balanced). */
export function bestCourtSplit(group: PlayerId[], history?: MatchHistory): {
  teamA: [PlayerId, PlayerId];
  teamB: [PlayerId, PlayerId];
  cost: number;
} {
  const [p0, p1, p2, p3] = group;
  const options: Split[] = [
    { teamA: [p0, p3], teamB: [p1, p2], imbalance: 0 }, // A: 1+4 vs 2+3
    { teamA: [p0, p2], teamB: [p1, p3], imbalance: 2 }, // B: 1+3 vs 2+4
    { teamA: [p0, p1], teamB: [p2, p3], imbalance: 4 }, // C: 1+2 vs 3+4
  ];

  // Priority stays strict: any repeat partnership (>= 100) outweighs every
  // repeat opponent on the court (4 pairs x 10 each, rarely more), which
  // outweighs imbalance (max 4).
  const cost = (o: Split): number => {
    let c = partnerCost(history, o.teamA[0], o.teamA[1]) + partnerCost(history, o.teamB[0], o.teamB[1]);
    for (const x of o.teamA) for (const y of o.teamB) c += opponentCost(history, x, y);
    return c + o.imbalance;
  };

  let best = options[0];
  let bestCost = cost(options[0]);
  for (let i = 1; i < options.length; i++) {
    const c = cost(options[i]);
    if (c < bestCost) {
      best = options[i];
      bestCost = c;
    }
  }
  return { teamA: best.teamA, teamB: best.teamB, cost: bestCost };
}

export function chooseCourtSplit(group: PlayerId[], history?: MatchHistory): {
  teamA: [PlayerId, PlayerId];
  teamB: [PlayerId, PlayerId];
} {
  const { teamA, teamB } = bestCourtSplit(group, history);
  return { teamA, teamB };
}
