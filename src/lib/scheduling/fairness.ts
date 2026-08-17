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

/** Soft cap: after this many games in a row, a player is due a forced rest so
 * nobody gets stuck on court for an exhausting streak (most visible for a
 * late joiner who'd otherwise play every round to catch up). "Soft" because it
 * only reorders WHO rests, never HOW MANY — so it can't leave a court short. */
export const MAX_CONSECUTIVE_PLAYED = 3;

export function selectPlayersForRound(
  activePlayerIds: PlayerId[],
  stateById: Map<PlayerId, PlayerFairnessState>,
  courtsAvailable: number,
  rng: Rng,
  maxConsecutivePlayed: number = MAX_CONSECUTIVE_PLAYED,
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
    const s = stateById.get(id) ?? { playerId: id, matchesPlayed: 0, restedLastRound: false, consecutivePlayed: 0 };
    const consecutivePlayed = s.consecutivePlayed ?? 0;
    return {
      id,
      matchesPlayed: s.matchesPlayed,
      restedLastRound: s.restedLastRound,
      // A player who's played the cap-many games in a row is "due" a rest and
      // jumps the rest queue regardless of total games played.
      dueForRest: consecutivePlayed >= maxConsecutivePlayed,
      consecutivePlayed,
      tie: rng(),
    };
  });

  // Sort "most deserving of a rest" first:
  //  0) anyone at the consecutive-play cap rests first (the soft streak cap) —
  //     among several capped players, the longest streak goes first.
  //  1) highest matchesPlayed rests next — this is what equalizes playing time
  //     (matchesPlayed + rests == rounds elapsed for everyone, so equalizing
  //     matchesPlayed automatically equalizes rest counts too).
  //  2) tie -> prefer resting someone who did NOT rest last round, to avoid
  //     back-to-back rests when an alternative exists.
  //  3) tie -> seeded random, so the same inputs always produce the same round.
  withKeys.sort((a, b) => {
    if (a.dueForRest !== b.dueForRest) return a.dueForRest ? -1 : 1;
    if (a.dueForRest && b.dueForRest && b.consecutivePlayed !== a.consecutivePlayed) {
      return b.consecutivePlayed - a.consecutivePlayed;
    }
    if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
    if (a.restedLastRound !== b.restedLastRound) return a.restedLastRound ? 1 : -1;
    return b.tie - a.tie;
  });

  const restingIds = withKeys.slice(0, restSlots).map((x) => x.id);
  const restingSet = new Set(restingIds);
  const playingIds = activePlayerIds.filter((id) => !restingSet.has(id));

  return { playingIds, restingIds, courtsUsed };
}

/**
 * Rebalance a round's pool so both halves of a two-valued attribute are equally
 * represented — without giving up the fairness order that produced it.
 *
 * WHY THIS EXISTS. selectPlayersForRound is deliberately blind to everything
 * except playing time, which is right for Americano and Mexicano and quietly
 * catastrophic for the formats where every TEAM must contain one of each key:
 * Mix Americano and Mix Mexicano (gender), and Fixed Position (court side).
 * Those engines score a non-mixed team at 100x any other fault — but no amount
 * of searching can mix a pool that has nobody to mix with.
 *
 * Measured, 8 players (4M/4F) on 1 court, before this existed:
 *
 *   round 1: pool 0M/4F -> 2 non-mixed teams
 *   round 2: pool 4M/0F -> 2 non-mixed teams
 *   round 3: pool 0M/4F -> 2 non-mixed teams        ...every round, forever.
 *
 * Sorting by matchesPlayed alone marched the whole roster through in blocks,
 * and each block happened to be one gender. Round 1 looked perfect and every
 * round after it was wrong — which is exactly how it was reported.
 *
 * THE REPAIR. Keep the fairness pick, then swap the minimum number of players
 * to even the split: take the over-represented player who has ALREADY PLAYED
 * THE MOST (so the swap costs the least fairness) and exchange them with the
 * under-represented rester who has played the LEAST (so the swap pays fairness
 * back). If the roster itself can't support an even split — seven men and one
 * woman — this gets as close as the roster allows and stops. It never changes
 * how MANY play, so it can't leave a court short.
 */
export function balancePoolByKey(
  selection: RestSelectionResult,
  keyById: Map<PlayerId, string>,
  stateById: Map<PlayerId, PlayerFairnessState>,
): RestSelectionResult {
  const { playingIds, restingIds, courtsUsed } = selection;
  if (courtsUsed === 0 || restingIds.length === 0) return selection;

  const played = (id: PlayerId) => stateById.get(id)?.matchesPlayed ?? 0;
  const playing = [...playingIds];
  const resting = [...restingIds];

  // Two-valued by construction (M/F, L/R). Anything else is left alone rather
  // than guessed at.
  const keys = [...new Set([...playing, ...resting].map((id) => keyById.get(id) ?? ""))].filter(Boolean);
  if (keys.length !== 2) return selection;

  const target = playing.length / 2;

  for (let guard = 0; guard < playing.length; guard++) {
    const countOf = (k: string) => playing.filter((id) => (keyById.get(id) ?? "") === k).length;
    const over = countOf(keys[0]) > target ? keys[0] : countOf(keys[1]) > target ? keys[1] : null;
    if (!over) break; // already even, or as even as an odd slot count allows
    const under = over === keys[0] ? keys[1] : keys[0];

    // Costs the least fairness: they've had the most court time already.
    const out = playing
      .filter((id) => (keyById.get(id) ?? "") === over)
      .sort((a, b) => played(b) - played(a))[0];
    // Pays it back: they've had the least.
    const inn = resting
      .filter((id) => (keyById.get(id) ?? "") === under)
      .sort((a, b) => played(a) - played(b))[0];
    if (!out || !inn) break; // the roster can't do better than this

    playing[playing.indexOf(out)] = inn;
    resting[resting.indexOf(inn)] = out;
  }

  return { playingIds: playing, restingIds: resting, courtsUsed };
}

/** True if any resting player also rested the previous round — surfaced in diagnostics (PRD §7). */
export function hasUnavoidableConsecutiveRest(
  restingIds: PlayerId[],
  stateById: Map<PlayerId, PlayerFairnessState>,
): PlayerId[] {
  return restingIds.filter((id) => stateById.get(id)?.restedLastRound);
}
