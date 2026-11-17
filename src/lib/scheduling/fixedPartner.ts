// Fixed Partner: two-player pairs are locked in for the WHOLE session — formed
// once at session start (manually by the host, or auto-generated), never
// re-shuffled. Only OPPONENTS rotate, round to round. Structurally this is a
// round-robin between fixed pairs: the same fairness core Americano/Mexicano
// use (rest whoever has played the most so far), just applied at the PAIR
// level instead of the individual level, plus an opponent-repeat local search
// (same shuffle-and-score approach as americano.ts) since there's no
// partner-repeat axis to worry about — partners never change.

import { Match, PlayerId, RoundResult, Rng, pairKey, mulberry32 } from "./types";
import type { SchedulePrior } from "./balance";

export interface Pair {
  /** Canonical id for this pair — pairKey(playerA, playerB), so it's stable
   * and never collides as long as no player is in two pairs at once. */
  pairId: string;
  playerA: PlayerId;
  playerB: PlayerId;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makePair(playerA: PlayerId, playerB: PlayerId): Pair {
  return { pairId: pairKey(playerA, playerB), playerA, playerB };
}

/** "AB" from "Alice" + "Bob" — the auto-label convention noted in
 * 0001_init.sql's schema comments ("pairs.label is auto-set to initials by
 * application code when a pair is created"). Falls back to "?" for a blank
 * name rather than throwing — display-only, never persisted as an id. */
export function pairLabel(nameA: string, nameB: string): string {
  const initial = (n: string) => (n.trim()[0] ?? "?").toUpperCase();
  return `${initial(nameA)}${initial(nameB)}`;
}

export function buildPairByPlayerId(pairs: Pair[]): Map<PlayerId, string> {
  const map = new Map<PlayerId, string>();
  for (const p of pairs) {
    map.set(p.playerA, p.pairId);
    map.set(p.playerB, p.pairId);
  }
  return map;
}

// ---- Pair formation (runs ONCE at session creation, never per round) ----

/** Shuffles the whole roster and pairs up consecutive players. */
export function formPairsRandom(playerIds: PlayerId[], rng: Rng): Pair[] {
  const order = shuffle(playerIds, rng);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < order.length; i += 2) {
    pairs.push(makePair(order[i], order[i + 1]));
  }
  return pairs;
}

export interface SidedPlayer {
  id: PlayerId;
  side: "left" | "right";
}

/**
 * Pairs one left-side player with one right-side player wherever possible —
 * the standard padel convention: a well-balanced pair has one drive (right)
 * and one revés (left) player. Best-effort when the left/right counts don't
 * match (e.g. 5 lefts, 3 rights): every left-right combo is used up first,
 * then any leftover same-side players are paired together rather than left
 * unpaired, same "best-effort, allow leftovers" spirit as Mix Americano/
 * Mexicano's gender mixing.
 */
export function formPairsByPosition(players: SidedPlayer[], rng: Rng): Pair[] {
  const lefts = shuffle(
    players.filter((p) => p.side === "left").map((p) => p.id),
    rng,
  );
  const rights = shuffle(
    players.filter((p) => p.side === "right").map((p) => p.id),
    rng,
  );
  const pairs: Pair[] = [];
  while (lefts.length > 0 && rights.length > 0) {
    pairs.push(makePair(lefts.pop()!, rights.pop()!));
  }
  const leftovers = shuffle([...lefts, ...rights], rng);
  for (let i = 0; i + 1 < leftovers.length; i += 2) {
    pairs.push(makePair(leftovers[i], leftovers[i + 1]));
  }
  return pairs;
}

// ---- Round generation (pairs are fixed input, never re-formed here) ----

export interface PairFairnessState {
  pairId: string;
  matchesPlayed: number;
  restedLastRound: boolean;
}

export interface PairHistory {
  /** pairKey(pairIdA, pairIdB) of every pair-vs-pair matchup already played. */
  opponentPairsSeen: Set<string>;
  /** How many times each pair-vs-pair matchup has been played. When absent,
   *  opponentPairsSeen stands in (seen = once). */
  opponentCounts?: Map<string, number>;
}

export function emptyPairHistory(): PairHistory {
  return { opponentPairsSeen: new Set(), opponentCounts: new Map() };
}

/** Folds a generated round into running pair history — call after a round is accepted. */
export function recordRoundInPairHistory(
  history: PairHistory,
  round: RoundResult,
  pairByPlayerId: Map<PlayerId, string>,
): void {
  for (const m of round.matches) {
    const pairA = pairByPlayerId.get(m.teamA[0]);
    const pairB = pairByPlayerId.get(m.teamB[0]);
    if (pairA && pairB) recordPairMatchup(history, pairA, pairB);
  }
}

export function recordPairMatchup(history: PairHistory, pairA: string, pairB: string): void {
  const key = pairKey(pairA, pairB);
  history.opponentPairsSeen.add(key);
  if (!history.opponentCounts) history.opponentCounts = new Map();
  history.opponentCounts.set(key, (history.opponentCounts.get(key) ?? 0) + 1);
}

function meetCount(history: PairHistory, a: string, b: string): number {
  const key = pairKey(a, b);
  return history.opponentCounts?.get(key) ?? (history.opponentPairsSeen.has(key) ? 1 : 0);
}

interface PairSelectionResult {
  playingPairs: Pair[];
  restingPairs: Pair[];
  courtsUsed: number;
}

/** Same "rest whoever's played the most" rule as fairness.ts's
 * selectPlayersForRound, just at pair granularity (2 pair-units per court,
 * not 4 individual players). Used by the rank-based flavor below; the
 * round-robin flavor chooses who rests and who plays whom together (see
 * generateFixedPartnerRound), under the same games-played rule. */
export function selectPairsForRound(
  pairs: Pair[],
  statsById: Map<string, PairFairnessState>,
  courtsAvailable: number,
  rng: Rng,
): PairSelectionResult {
  const n = pairs.length;
  const courtsUsed = Math.min(Math.max(0, courtsAvailable), Math.floor(n / 2));
  const playSlots = courtsUsed * 2;
  const restSlots = n - playSlots;

  if (courtsUsed === 0) return { playingPairs: [], restingPairs: [...pairs], courtsUsed: 0 };
  if (restSlots === 0) return { playingPairs: [...pairs], restingPairs: [], courtsUsed };

  const withKeys = pairs.map((p) => {
    const s = statsById.get(p.pairId) ?? { pairId: p.pairId, matchesPlayed: 0, restedLastRound: false };
    return { pair: p, matchesPlayed: s.matchesPlayed, restedLastRound: s.restedLastRound, tie: rng() };
  });
  withKeys.sort((a, b) => {
    if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
    if (a.restedLastRound !== b.restedLastRound) return a.restedLastRound ? 1 : -1;
    return b.tie - a.tie;
  });

  const restingPairs = withKeys.slice(0, restSlots).map((x) => x.pair);
  const restingSet = new Set(restingPairs.map((p) => p.pairId));
  const playingPairs = pairs.filter((p) => !restingSet.has(p.pairId));

  return { playingPairs, restingPairs, courtsUsed };
}

// Weights for choosing a round. A repeated matchup always costs more than any
// amount of the softer preferences, so a pair never meets someone twice while
// a never-played opponent could have been scheduled instead.
const REPEAT_COST = 1000;
const REST_AGAIN_COST = 40; // resting two rounds running
const UNMET_REST_COST = 3; // resting a pair that still has many opponents to meet

/** Every way to split `pool` into `pairsOf2` disjoint matchups, cheapest first
 *  found by branch and bound. Exact for the sizes a padel night has (up to 8
 *  courts = 16 pairs on court) within the node budget; falls back to the best
 *  found so far beyond it. */
function bestMatching(pool: Pair[], cost: (a: Pair, b: Pair) => number, rng: Rng): { matchups: [Pair, Pair][]; cost: number } {
  const order = shuffle(pool, rng);
  let best: [Pair, Pair][] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  let nodes = 0;
  const used = new Array(order.length).fill(false);
  const cur: [Pair, Pair][] = [];
  const walk = (acc: number) => {
    if (acc >= bestCost || nodes++ > 60000) return;
    const i = used.indexOf(false);
    if (i < 0) {
      best = [...cur];
      bestCost = acc;
      return;
    }
    used[i] = true;
    const options: { j: number; c: number }[] = [];
    for (let j = i + 1; j < order.length; j++) if (!used[j]) options.push({ j, c: cost(order[i], order[j]) });
    options.sort((x, y) => x.c - y.c);
    for (const { j, c } of options) {
      used[j] = true;
      cur.push([order[i], order[j]]);
      walk(acc + c);
      cur.pop();
      used[j] = false;
    }
    used[i] = false;
  };
  walk(0);
  return { matchups: best ?? [], cost: bestCost };
}

/** All k-element subsets of `items` (at most `limit`, sampled if more). */
function subsets<T>(items: T[], k: number, rng: Rng, limit = 400): T[][] {
  const out: T[][] = [];
  if (k <= 0) return [[]];
  if (k > items.length) return [];
  const rec = (start: number, acc: T[]) => {
    if (out.length >= limit * 4) return;
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i++) rec(i + 1, [...acc, items[i]]);
  };
  rec(0, []);
  return out.length <= limit ? out : shuffle(out, rng).slice(0, limit);
}

export interface GenerateFixedPartnerRoundInput {
  pairs: Pair[];
  statsById: Map<string, PairFairnessState>;
  courtsAvailable: number;
  history: PairHistory;
  rng: Rng;
  /** Kept for callers; the search below is exact, not sampled. */
  tries?: number;
}

/**
 * One round of the round-robin flavor. Who rests and who plays whom are
 * chosen TOGETHER (Nov 2026 fix). Before, the resting pairs were picked first
 * on games played alone and the six left were then matched as well as they
 * could be, so by the last rounds the only matchups still unplayed were
 * between pairs that had been sent to rest, and the night ended with repeats
 * and a pair that never met another.
 *
 * Rules, in order:
 *   1. Games stay level: a pair never rests while a pair with more games
 *      plays. (Same rule as every other format.)
 *   2. Nobody meets an opponent again while they still have someone unplayed
 *      who could be put on the same court instead.
 *   3. Nobody rests two rounds running if it can be helped, and pairs with
 *      the most opponents still to meet are kept on court.
 */
export function generateFixedPartnerRound(input: GenerateFixedPartnerRoundInput): RoundResult {
  const { pairs, statsById, courtsAvailable, history, rng } = input;
  const n = pairs.length;
  const courtsUsed = Math.min(Math.max(0, courtsAvailable), Math.floor(n / 2));

  if (courtsUsed === 0) {
    return {
      courtsUsed: 0,
      matches: [],
      restingIds: pairs.flatMap((p) => [p.playerA, p.playerB]),
      explanation: `Not enough active pairs for a full court (need 2 pairs, have ${pairs.length}).`,
    };
  }

  const stat = (p: Pair) => statsById.get(p.pairId) ?? { pairId: p.pairId, matchesPlayed: 0, restedLastRound: false };
  const restSlots = n - courtsUsed * 2;
  const unmetLeft = (p: Pair) => pairs.filter((q) => q.pairId !== p.pairId && meetCount(history, p.pairId, q.pairId) === 0).length;

  // Rule 1: who MUST rest (more games than the boundary) and who MAY.
  const byGames = [...pairs].sort((a, b) => stat(b).matchesPlayed - stat(a).matchesPlayed);
  let mustRest: Pair[] = [];
  let mayRest: Pair[] = [];
  if (restSlots > 0) {
    const boundary = stat(byGames[restSlots - 1]).matchesPlayed;
    mustRest = pairs.filter((p) => stat(p).matchesPlayed > boundary);
    mayRest = pairs.filter((p) => stat(p).matchesPlayed === boundary);
  }
  const restChoices = restSlots > 0 ? subsets(mayRest, restSlots - mustRest.length, rng).map((c) => [...mustRest, ...c]) : [[]];

  // The cheapest opponent a pair could still get: 0 if any unplayed opponent
  // exists among the pairs on court, else the fewest times met.
  const matchCost = (a: Pair, b: Pair) => REPEAT_COST * meetCount(history, a.pairId, b.pairId);

  let best: { rest: Pair[]; matchups: [Pair, Pair][]; cost: number } | null = null;
  for (const rest of restChoices) {
    const restIds = new Set(rest.map((p) => p.pairId));
    const pool = pairs.filter((p) => !restIds.has(p.pairId));
    let restCost = 0;
    for (const r of rest) {
      if (stat(r).restedLastRound) restCost += REST_AGAIN_COST;
      restCost += UNMET_REST_COST * unmetLeft(r);
    }
    if (best && restCost >= best.cost) continue;
    const m = bestMatching(pool, matchCost, rng);
    const total = m.cost + restCost + rng() * 0.5; // tiny jitter: seeded variety between equals
    if (!best || total < best.cost) best = { rest, matchups: m.matchups, cost: total };
  }

  const restingPairs = best!.rest;
  const matchups = best!.matchups;
  const matches: Match[] = matchups.map(([pairA, pairB]) => ({
    courtIndex: -1, // assigned below
    teamA: [pairA.playerA, pairA.playerB],
    teamB: [pairB.playerA, pairB.playerB],
  }));

  const courtOrder = shuffle(
    Array.from({ length: courtsUsed }, (_, i) => i),
    rng,
  );
  matches.forEach((m, i) => {
    m.courtIndex = courtOrder[i % courtOrder.length];
  });
  matches.sort((a, b) => a.courtIndex - b.courtIndex);

  const repeats = matchups.filter(([a, b]) => meetCount(history, a.pairId, b.pairId) > 0).length;
  const explanationParts = [
    `${courtsUsed * 2} of ${pairs.length} pairs are on court this round across ${courtsUsed} court${courtsUsed > 1 ? "s" : ""}.`,
  ];
  if (restingPairs.length > 0) {
    explanationParts.push(`${restingPairs.length} pair(s) rest this round, chosen from the pairs that have played the most.`);
  }
  if (repeats > 0) {
    explanationParts.push(`${repeats} repeated pair-vs-pair matchup(s) were unavoidable this round.`);
  }

  return {
    courtsUsed,
    matches,
    restingIds: restingPairs.flatMap((p) => [p.playerA, p.playerB]),
    explanation: explanationParts.join(" "),
  };
}

export interface GenerateFixedPartnerScheduleInput {
  pairs: Pair[];
  courtsAvailable: number;
  roundCount: number;
  schedulingSeed: number;
  /** What has already been played before these rounds (redraw / added rounds),
   *  so pairs that already met aren't put together again first. */
  prior?: SchedulePrior;
}

/** Pair-level games, rests and meetings from a player-level prior. Fixed
 *  partners always play together, so either partner's numbers are the pair's. */
function pairStart(pairs: Pair[], prior: SchedulePrior | undefined) {
  const statsById = new Map<string, PairFairnessState>(
    pairs.map((p) => [
      p.pairId,
      {
        pairId: p.pairId,
        matchesPlayed: prior?.playCounts.get(p.playerA) ?? 0,
        restedLastRound: prior?.restedLast.has(p.playerA) ?? false,
      },
    ]),
  );
  const history = emptyPairHistory();
  if (prior) {
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const met = prior.history.opponentCounts.get(pairKey(pairs[i].playerA, pairs[j].playerA)) ?? 0;
        for (let k = 0; k < met; k++) recordPairMatchup(history, pairs[i].pairId, pairs[j].pairId);
      }
    }
  }
  return { statsById, history };
}

/** What makes one whole schedule better than another, lowest first. */
function scheduleCost(rounds: RoundResult[], pairs: Pair[], prior?: SchedulePrior): number {
  const pairByPlayerId = buildPairByPlayerId(pairs);
  const start = pairStart(pairs, prior);
  const history = start.history;
  const lastRested = new Map<string, number>();
  for (const p of pairs) if (start.statsById.get(p.pairId)!.restedLastRound) lastRested.set(p.pairId, -1);
  let cost = 0;
  rounds.forEach((r, i) => {
    const total = pairs.length * (pairs.length - 1) / 2;
    for (const m of r.matches) {
      const a = pairByPlayerId.get(m.teamA[0])!;
      const b = pairByPlayerId.get(m.teamB[0])!;
      const seen = meetCount(history, a, b);
      // A repeat while some matchup is still unplayed is the worst outcome.
      if (seen > 0 && (history.opponentCounts?.size ?? 0) < total) cost += REPEAT_COST;
      cost += seen * 50;
      recordPairMatchup(history, a, b);
    }
    const playing = new Set(r.matches.flatMap((m) => [pairByPlayerId.get(m.teamA[0])!, pairByPlayerId.get(m.teamB[0])!]));
    for (const p of pairs) {
      if (playing.has(p.pairId)) continue;
      if (lastRested.get(p.pairId) === i - 1) cost += REST_AGAIN_COST;
      lastRested.set(p.pairId, i);
    }
  });
  return cost;
}

function buildSchedule(pairs: Pair[], courtsAvailable: number, roundCount: number, seed: number, prior?: SchedulePrior): RoundResult[] {
  const { statsById, history } = pairStart(pairs, prior);
  const pairByPlayerId = buildPairByPlayerId(pairs);
  const rounds: RoundResult[] = [];

  for (let sequence = 1; sequence <= roundCount; sequence++) {
    const rng = mulberry32(seed + sequence);
    const result = generateFixedPartnerRound({ pairs, statsById, courtsAvailable, history, rng });
    if (result.courtsUsed === 0) break; // not enough pairs — stop rather than push empty rounds

    rounds.push(result);
    recordRoundInPairHistory(history, result, pairByPlayerId);

    const playingPairIds = new Set<string>();
    for (const m of result.matches) {
      playingPairIds.add(pairByPlayerId.get(m.teamA[0])!);
      playingPairIds.add(pairByPlayerId.get(m.teamB[0])!);
    }
    for (const p of pairs) {
      const s = statsById.get(p.pairId)!;
      statsById.set(
        p.pairId,
        playingPairIds.has(p.pairId)
          ? { pairId: p.pairId, matchesPlayed: s.matchesPlayed + 1, restedLastRound: false }
          : { pairId: p.pairId, matchesPlayed: s.matchesPlayed, restedLastRound: true },
      );
    }
  }
  return rounds;
}

/**
 * Generates the FULL Fixed Partner schedule up front, same reasoning as
 * Americano/Team Sparring: pairing never depends on scores (pairs are fixed,
 * and opponent rotation only depends on who's played whom before), so the
 * whole thing can be committed at session start.
 *
 * Round by round can still paint itself into a corner, so several complete
 * schedules are drawn (each deterministic from the session seed) and the one
 * where every pair meets every other before anyone meets twice, with the
 * fewest back-to-back rests, is kept.
 */
export function generateFixedPartnerSchedule(input: GenerateFixedPartnerScheduleInput): RoundResult[] {
  const { pairs, courtsAvailable, roundCount, schedulingSeed, prior } = input;
  let best: RoundResult[] = [];
  let bestCost = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 24; attempt++) {
    const rounds = buildSchedule(pairs, courtsAvailable, roundCount, schedulingSeed + attempt * 104729, prior);
    const cost = scheduleCost(rounds, pairs, prior);
    if (cost < bestCost) {
      best = rounds;
      bestCost = cost;
      if (cost === 0) break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fixed Partner, Mexicano-flavored: same fixed pairs, but instead of a
// round-robin rotation, pairs are matched by CURRENT STANDING each round —
// rank1-pair vs rank2-pair, rank3-pair vs rank4-pair, and so on — so pairs of
// similar skill keep playing close matches, exactly like Mexicano does for
// individuals. Because pairing depends on live standings (except round 1),
// this stays round-by-round like Mexicano — no upfront full-schedule
// generator the way the round-robin flavor above gets.
//
// One shortcut worth knowing: since partners always play together, both
// members of a pair always have IDENTICAL individual stats (same side, same
// match, every round) — so "the pair's rank" is just either partner's
// individual rankValue. Callers can hand in the same rankValueById lookup
// Mexicano itself uses; no separate pair-standings computation needed.
// ---------------------------------------------------------------------------

export interface PairStandingLookup {
  /** Current points or wins for the PAIR — in practice, either partner's own
   * individual rankValue works, since fixed partners always share stats. */
  rankValue(pairId: string): number;
}

export interface GenerateFixedPartnerRankedRoundInput {
  pairs: Pair[];
  statsById: Map<string, PairFairnessState>;
  courtsAvailable: number;
  standings: PairStandingLookup;
  /** True only for round 1 (or whenever nobody has a meaningful standing yet). */
  isFirstRound: boolean;
  rng: Rng;
}

export function generateFixedPartnerRankedRound(input: GenerateFixedPartnerRankedRoundInput): RoundResult {
  const { pairs, statsById, courtsAvailable, standings, isFirstRound, rng } = input;

  // STEP 1 — which pairs play. Identical fairness rule as the round-robin
  // flavor; rank plays no part, same principle Mexicano itself follows.
  const { playingPairs, restingPairs, courtsUsed } = selectPairsForRound(pairs, statsById, courtsAvailable, rng);

  if (courtsUsed === 0) {
    return {
      courtsUsed: 0,
      matches: [],
      restingIds: restingPairs.flatMap((p) => [p.playerA, p.playerB]),
      explanation: `Not enough active pairs for a full court (need 2 pairs, have ${pairs.length}).`,
    };
  }

  const slots = courtsUsed * 2;
  const playPool = playingPairs.slice(0, slots);

  // STEP 2 — how they match up. Rank the PLAYING subset only (never the
  // resters), then face adjacent ranks: rank1 vs rank2, rank3 vs rank4...
  // Round 1 has no real standing yet, so it uses the same deterministic
  // seeded shuffle Mexicano's round 1 does instead of true rank.
  const ranked = isFirstRound
    ? shuffle(playPool, rng)
    : [...playPool].sort((a, b) => standings.rankValue(b.pairId) - standings.rankValue(a.pairId));

  const matches: Match[] = [];
  for (let i = 0; i + 1 < ranked.length; i += 2) {
    matches.push({
      courtIndex: Math.floor(i / 2),
      teamA: [ranked[i].playerA, ranked[i].playerB],
      teamB: [ranked[i + 1].playerA, ranked[i + 1].playerB],
    });
  }

  const explanationParts = [
    `${playPool.length} of ${pairs.length} pairs are on court this round across ${courtsUsed} court${courtsUsed > 1 ? "s" : ""}.`,
  ];
  if (restingPairs.length > 0) {
    explanationParts.push(`${restingPairs.length} pair(s) rest this round, chosen by fewest matches played so far — never by rank.`);
  }
  explanationParts.push(
    isFirstRound
      ? "Round 1 matchups are randomized (deterministic session seed) since nobody has a standing yet."
      : "Pairs on court are matched by current standing — rank1 vs rank2, rank3 vs rank4, and so on.",
  );

  return {
    courtsUsed,
    matches,
    restingIds: restingPairs.flatMap((p) => [p.playerA, p.playerB]),
    explanation: explanationParts.join(" "),
  };
}
