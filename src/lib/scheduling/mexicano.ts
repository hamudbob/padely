// Mexicano — the corrected two-step algorithm (see mexicano_algorithm_fix.md for
// the full diagnosis of why the old app got this wrong).
//
// STEP 1 decides WHO plays. Rank is not a factor here — it's pure playing-time
// fairness via the shared fairness core, exactly like Americano uses.
//
// STEP 2 decides HOW the selected players pair up. Only now does rank enter:
// the players chosen to play are sorted by current standings and grouped into
// nearby-rank groups of 4, paired rank1+rank4 vs rank2+rank3 by default (PRD §6).
//
// This ordering is the entire fix. The old app ran rank-selection first, which
// is what let a bottom-ranked group get stuck resting forever.

import {
  Match,
  MatchHistory,
  PlayerFairnessState,
  PlayerId,
  RoundResult,
  Rng,
} from "./types";
import { selectPlayersForRound, hasUnavoidableConsecutiveRest } from "./fairness";
import { bestCourtSplit } from "./courtSplit";

export interface StandingLookup {
  /** Current points or wins (whatever the session's ranking_basis is) — higher is better. */
  rankValue(playerId: PlayerId): number;
}

export interface GenerateMexicanoRoundInput {
  activePlayerIds: PlayerId[];
  statsById: Map<PlayerId, PlayerFairnessState>;
  courtsAvailable: number;
  standings: StandingLookup;
  /** True only for round 1 (or whenever nobody has a meaningful standing yet). */
  isFirstRound: boolean;
  /** Partner/opponent history so within-court pairing can rotate partners and
   * avoid repeats. Optional — without it, pairing falls back to balanced-only. */
  history?: MatchHistory;
  rng: Rng;
}

export function generateMexicanoRound(input: GenerateMexicanoRoundInput): RoundResult {
  const { activePlayerIds, statsById, courtsAvailable, standings, isFirstRound, history, rng } = input;

  // STEP 1 — who plays. Identical fairness rule as Americano; rank plays no part.
  const { playingIds, restingIds, courtsUsed } = selectPlayersForRound(
    activePlayerIds,
    statsById,
    courtsAvailable,
    rng,
  );

  if (courtsUsed === 0) {
    return {
      courtsUsed: 0,
      matches: [],
      restingIds,
      explanation: `Not enough active players for a full court (need 4, have ${activePlayerIds.length}).`,
    };
  }

  const slots = courtsUsed * 4;
  const playPool = playingIds.slice(0, slots);

  // STEP 2 — how they pair up. Rank the PLAYING subset only (never the resters).
  // Round 1: nobody has a standing yet, so use the deterministic seed instead
  // of true rank (PRD §6: "In round one all players are equal; randomize
  // deterministically with a stored session seed").
  const ranked = isFirstRound
    ? shuffleDeterministic(playPool, rng)
    : [...playPool].sort((a, b) => standings.rankValue(b) - standings.rankValue(a));

  // Courts in rank order, with one allowance: two players either side of a
  // court boundary (4th and 5th, 8th and 9th, ...) may swap courts when that
  // spares someone a repeat partner. Players a single place apart in the
  // standings are as close in level as it gets, so the courts stay Mexicano;
  // without this, a top four that keeps winning plays only each other all
  // night and every partnership comes round again and again.
  const ordered = isFirstRound ? ranked : arrangeCourts(ranked, history);

  const matches: Match[] = [];
  for (let i = 0; i + 3 < ordered.length; i += 4) {
    const group = ordered.slice(i, i + 4); // [rank1, rank2, rank3, rank4] within this group
    // Partners are chosen by a soft rule: prefer a split that avoids repeat
    // partnerships (then repeat opponents), with the balanced 1st+4th vs
    // 2nd+3rd as the tiebreak. It never fails — if every split repeats, it
    // takes the least-repeating one.
    const { teamA, teamB } = bestCourtSplit(group, history);
    matches.push({ courtIndex: Math.floor(i / 4), teamA, teamB });
  }

  const consecutiveRests = hasUnavoidableConsecutiveRest(restingIds, statsById);
  const explanationParts = [
    `${playPool.length} of ${activePlayerIds.length} active players are on court this round across ${courtsUsed} court${courtsUsed > 1 ? "s" : ""}.`,
  ];
  if (restingIds.length > 0) {
    explanationParts.push(`${restingIds.length} rest this round, chosen by fewest matches played so far — never by rank.`);
  }
  if (consecutiveRests.length > 0) {
    explanationParts.push(
      `${consecutiveRests.length} player(s) rest two rounds in a row — unavoidable given the current player/court count.`,
    );
  }
  explanationParts.push(
    isFirstRound
      ? "Round 1 pairing is randomized (deterministic session seed) since nobody has a standing yet."
      : "Players on court are grouped into nearby-rank groups of 4 by current standings; partners rotate each round to avoid repeats while keeping the two teams balanced.",
  );

  return { courtsUsed, matches, restingIds, explanation: explanationParts.join(" ") };
}

/** What one boundary swap "costs": a little under one repeat partnership, so a
 * swap happens only when it actually spares a repeat partner. */
const SWAP_COST = 90;

/**
 * Try every combination of boundary swaps (2^(courts-1): at most 32 for six
 * courts) and keep the cheapest: fewest/least-repeated partners first, then
 * fewest swaps. No randomness — the same standings and history always give
 * the same courts, so Refresh and the co-host draw stay deterministic.
 */
export function arrangeCourts(ranked: PlayerId[], history?: MatchHistory): PlayerId[] {
  const courts = Math.floor(ranked.length / 4);
  if (!history || courts < 2) return ranked;

  const costOf = (order: PlayerId[]): number => {
    let c = 0;
    for (let i = 0; i + 3 < order.length; i += 4) c += bestCourtSplit(order.slice(i, i + 4), history).cost;
    return c;
  };

  let best = ranked;
  let bestCost = costOf(ranked);
  for (let mask = 1; mask < 1 << (courts - 1); mask++) {
    const order = [...ranked];
    let swaps = 0;
    for (let b = 0; b < courts - 1; b++) {
      if (mask & (1 << b)) {
        const i = b * 4 + 3;
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
        swaps++;
      }
    }
    const c = costOf(order) + swaps * SWAP_COST;
    if (c < bestCost) {
      best = order;
      bestCost = c;
    }
  }
  return best;
}

function shuffleDeterministic<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
