// Shared types for the scheduling engines. Framework-free — no React, no Supabase.
// These mirror the DB shape (see supabase/migrations/0001_init.sql) closely enough
// to map 1:1 when persisting, but the engines only ever operate on plain data.

export type PlayerId = string;

export interface EngineRules {
  /** How many players a single match needs on court (always 4 in Phase 1: 2v2). */
  playersPerMatch: 4;
  /** Hard rule (correction #4): a court only runs if fully staffed. */
  minPlayersPerCourt: 4;
}

export const ENGINE_RULES: EngineRules = {
  playersPerMatch: 4,
  minPlayersPerCourt: 4,
};

/** Per-player rolling fairness state the scheduler needs to make its next decision. */
export interface PlayerFairnessState {
  playerId: PlayerId;
  matchesPlayed: number;
  restedLastRound: boolean;
}

export interface Match {
  courtIndex: number; // 0-based, stable ordinal within the round
  teamA: [PlayerId, PlayerId];
  teamB: [PlayerId, PlayerId];
}

export interface RoundResult {
  courtsUsed: number;
  matches: Match[];
  restingIds: PlayerId[];
  /** Human-readable, matches PRD §7 "plain language explanation" requirement. */
  explanation: string;
}

/** Canonical, order-independent key for an unordered pair — used to detect repeats. */
export function pairKey(a: PlayerId, b: PlayerId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface MatchHistory {
  /** Every partner pair (teammates) that has occurred in a previous completed/planned round. */
  partnerPairsSeen: Set<string>;
  /** Every opponent pair (across the net from each other) seen previously. */
  opponentPairsSeen: Set<string>;
  /** courtIndex a player last appeared on, for light court-repeat spreading. */
  lastCourtByPlayer: Map<PlayerId, number>;
}

export function emptyHistory(): MatchHistory {
  return {
    partnerPairsSeen: new Set(),
    opponentPairsSeen: new Set(),
    lastCourtByPlayer: new Map(),
  };
}

/** Fold a generated round into running history — call after a round is accepted. */
export function recordRoundInHistory(history: MatchHistory, round: RoundResult): void {
  for (const m of round.matches) {
    history.partnerPairsSeen.add(pairKey(m.teamA[0], m.teamA[1]));
    history.partnerPairsSeen.add(pairKey(m.teamB[0], m.teamB[1]));
    for (const a of m.teamA) {
      for (const b of m.teamB) {
        history.opponentPairsSeen.add(pairKey(a, b));
      }
    }
    for (const p of [...m.teamA, ...m.teamB]) {
      history.lastCourtByPlayer.set(p, m.courtIndex);
    }
  }
}

/** Deterministic seeded PRNG (mulberry32) — same seed always produces the same round. */
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
