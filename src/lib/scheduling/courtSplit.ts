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

export function chooseCourtSplit(group: PlayerId[], history?: MatchHistory): {
  teamA: [PlayerId, PlayerId];
  teamB: [PlayerId, PlayerId];
} {
  const [p0, p1, p2, p3] = group;
  const options: Split[] = [
    { teamA: [p0, p3], teamB: [p1, p2], imbalance: 0 }, // A: 1+4 vs 2+3
    { teamA: [p0, p2], teamB: [p1, p3], imbalance: 2 }, // B: 1+3 vs 2+4
    { teamA: [p0, p1], teamB: [p2, p3], imbalance: 4 }, // C: 1+2 vs 3+4
  ];

  const cost = (o: Split): number => {
    let partnerRepeat = 0;
    let opponentRepeat = 0;
    if (history) {
      if (history.partnerPairsSeen.has(pairKey(o.teamA[0], o.teamA[1]))) partnerRepeat++;
      if (history.partnerPairsSeen.has(pairKey(o.teamB[0], o.teamB[1]))) partnerRepeat++;
      for (const x of o.teamA) {
        for (const y of o.teamB) {
          if (history.opponentPairsSeen.has(pairKey(x, y))) opponentRepeat++;
        }
      }
    }
    // Weights keep the priority order strict: one repeat partnership (100)
    // always outranks any number of repeat opponents (max 4*10=40), which in
    // turn always outranks imbalance (max 4).
    return partnerRepeat * 100 + opponentRepeat * 10 + o.imbalance;
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
  return { teamA: best.teamA, teamB: best.teamB };
}
