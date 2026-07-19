// Fixed Partner: two-player pairs are locked in for the WHOLE session — formed
// once at session start (manually by the host, or auto-generated), never
// re-shuffled. Only OPPONENTS rotate, round to round. Structurally this is a
// round-robin between fixed pairs: the same fairness core Americano/Mexicano
// use (rest whoever has played the most so far), just applied at the PAIR
// level instead of the individual level, plus an opponent-repeat local search
// (same shuffle-and-score approach as americano.ts) since there's no
// partner-repeat axis to worry about — partners never change.

import { Match, PlayerId, RoundResult, Rng, pairKey, mulberry32 } from "./types";

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
}

export function emptyPairHistory(): PairHistory {
  return { opponentPairsSeen: new Set() };
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
    if (pairA && pairB) history.opponentPairsSeen.add(pairKey(pairA, pairB));
  }
}

interface PairSelectionResult {
  playingPairs: Pair[];
  restingPairs: Pair[];
  courtsUsed: number;
}

/** Same "rest whoever's played the most" rule as fairness.ts's
 * selectPlayersForRound, just at pair granularity (2 pair-units per court,
 * not 4 individual players) — kept as its own function rather than
 * generalizing the shared one, matching how teamSparring.ts also wrote its
 * own side-aware selection instead of reusing the individual-player version.
 * Exported so generateFixedPartnerRankedRound below can share it — WHO
 * plays is identical fairness logic regardless of how they're then matched
 * up (round-robin vs rank-based), same split americano.ts/mexicano.ts use. */
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

function scorePairMatchups(matchups: [Pair, Pair][], history: PairHistory): number {
  let repeats = 0;
  for (const [a, b] of matchups) {
    if (history.opponentPairsSeen.has(pairKey(a.pairId, b.pairId))) repeats++;
  }
  return repeats;
}

export interface GenerateFixedPartnerRoundInput {
  pairs: Pair[];
  statsById: Map<string, PairFairnessState>;
  courtsAvailable: number;
  history: PairHistory;
  rng: Rng;
  /** How many randomized attempts to try when minimizing repeat matchups. */
  tries?: number;
}

export function generateFixedPartnerRound(input: GenerateFixedPartnerRoundInput): RoundResult {
  const { pairs, statsById, courtsAvailable, history, rng, tries = 300 } = input;

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

  // Randomized local search: try many random pair-vs-pair matchups, keep the
  // one with the fewest repeated opponent-pair matchups against history.
  // No partner-repeat term needed here — unlike Americano, partners are
  // permanently fixed, so there's nothing to optimize on that axis.
  let best: [Pair, Pair][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let t = 0; t < tries; t++) {
    const order = shuffle(playPool, rng);
    const candidate: [Pair, Pair][] = [];
    for (let i = 0; i + 1 < order.length; i += 2) candidate.push([order[i], order[i + 1]]);
    const score = scorePairMatchups(candidate, history);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
      if (score === 0) break;
    }
  }
  const matchups: [Pair, Pair][] =
    best ??
    (() => {
      const fallback: [Pair, Pair][] = [];
      for (let i = 0; i + 1 < playPool.length; i += 2) fallback.push([playPool[i], playPool[i + 1]]);
      return fallback;
    })();

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

  const repeats = scorePairMatchups(matchups, history);
  const explanationParts = [
    `${playPool.length} of ${pairs.length} pairs are on court this round across ${courtsUsed} court${courtsUsed > 1 ? "s" : ""}.`,
  ];
  if (restingPairs.length > 0) {
    explanationParts.push(`${restingPairs.length} pair(s) rest this round, chosen by fewest matches played so far.`);
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
}

/**
 * Generates the FULL Fixed Partner schedule up front, same reasoning as
 * Americano/Team Sparring: pairing never depends on scores (pairs are fixed,
 * and opponent rotation only depends on who's played whom before), so the
 * whole thing can be committed at session start.
 */
export function generateFixedPartnerSchedule(input: GenerateFixedPartnerScheduleInput): RoundResult[] {
  const { pairs, courtsAvailable, roundCount, schedulingSeed } = input;

  const statsById = new Map<string, PairFairnessState>(
    pairs.map((p) => [p.pairId, { pairId: p.pairId, matchesPlayed: 0, restedLastRound: false }]),
  );
  const history = emptyPairHistory();
  const pairByPlayerId = buildPairByPlayerId(pairs);
  const rounds: RoundResult[] = [];

  for (let sequence = 1; sequence <= roundCount; sequence++) {
    const rng = mulberry32(schedulingSeed + sequence);
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
