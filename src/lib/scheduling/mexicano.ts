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
import { chooseCourtSplit } from "./courtSplit";

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

  const matches: Match[] = [];
  for (let i = 0; i + 3 < ranked.length; i += 4) {
    const group = ranked.slice(i, i + 4); // [rank1, rank2, rank3, rank4] within this group
    // Partners are chosen by a soft rule: prefer a split that avoids repeat
    // partnerships (then repeat opponents), with the balanced 1st+4th vs
    // 2nd+3rd as the tiebreak. It never fails — if every split repeats, it
    // takes the least-repeating one.
    const { teamA, teamB } = chooseCourtSplit(group, history);
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

function shuffleDeterministic<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
