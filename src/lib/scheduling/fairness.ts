// The core fix for the old app's Mexicano bug (see mexicano_algorithm_fix.md).
//
// WHO PLAYS a round must be decided before HOW they're paired, and must be decided
// purely by playing-time fairness — never by rank. The old app sorted everyone by
// rank first and took a rotating window of that sorted list, which meant rank was
// silently deciding who got to play, and low-rank players who never played could
// never earn points to climb out of the bottom. This module is the fix: it looks
// only at matchesPlayed / restedLastRound, never at points or rank.
//
// Shared by both Americano and Mexicano so the two engines can never drift apart
// on this rule.

import { PlayerFairnessState, PlayerId, Rng } from "./types";

export interface RestSelectionResult {
  playingIds: PlayerId[];
  restingIds: PlayerId[];
  courtsUsed: number;
}

export function selectPlayersForRound(
  activePlayerIds: PlayerId[],
  stateById: Map<PlayerId, PlayerFairnessState>,
  courtsAvailable: number,
  rng: Rng,
): RestSelectionResult {
  const n = activePlayerIds.length;
  const courtsUsed = Math.min(Math.max(0, courtsAvailable), Math.floor(n / 4));
  const playSlots = courtsUsed * 4;
  const restSlots = n - playSlots;

  if (courtsUsed === 0) {
    return { playingIds: [], restingIds: [...activePlayerIds], courtsUsed: 0 };
  }
  if (restSlots === 0) {
    return { playingIds: [...activePlayerIds], restingIds: [], courtsUsed };
  }

  const withKeys = activePlayerIds.map((id) => {
    const s = stateById.get(id) ?? { playerId: id, matchesPlayed: 0, restedLastRound: false };
    return {
      id,
      matchesPlayed: s.matchesPlayed,
      restedLastRound: s.restedLastRound,
      tie: rng(),
    };
  });

  // Sort "most deserving of a rest" first:
  //  1) highest matchesPlayed rests first — this is what equalizes playing time
  //     (matchesPlayed + rests == rounds elapsed for everyone, so equalizing
  //     matchesPlayed automatically equalizes rest counts too).
  //  2) tie -> prefer resting someone who did NOT rest last round, to avoid
  //     back-to-back rests when an alternative exists.
  //  3) tie -> seeded random, so the same inputs always produce the same round.
  withKeys.sort((a, b) => {
    if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
    if (a.restedLastRound !== b.restedLastRound) return a.restedLastRound ? 1 : -1;
    return b.tie - a.tie;
  });

  const restingIds = withKeys.slice(0, restSlots).map((x) => x.id);
  const restingSet = new Set(restingIds);
  const playingIds = activePlayerIds.filter((id) => !restingSet.has(id));

  return { playingIds, restingIds, courtsUsed };
}

/** True if any resting player also rested the previous round — surfaced in diagnostics (PRD §7). */
export function hasUnavoidableConsecutiveRest(
  restingIds: PlayerId[],
  stateById: Map<PlayerId, PlayerFairnessState>,
): PlayerId[] {
  return restingIds.filter((id) => stateById.get(id)?.restedLastRound);
}
