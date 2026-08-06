// Americano: partners rotate every round, individual standings. Target is for
// everyone to partner with everyone else once (exact for ideal player/court
// counts, best-effort with honest diagnostics otherwise — PRD §6 Americano).

import {
  Match,
  MatchHistory,
  PlayerFairnessState,
  PlayerId,
  RoundResult,
  Rng,
  pairKey,
  emptyHistory,
  mulberry32,
  recordRoundInHistory,
} from "./types";
import { selectPlayersForRound, hasUnavoidableConsecutiveRest } from "./fairness";

function scorePairing(
  matches: Match[],
  history: MatchHistory,
): { partnerRepeats: number; opponentRepeats: number } {
  let partnerRepeats = 0;
  let opponentRepeats = 0;
  for (const m of matches) {
    if (history.partnerPairsSeen.has(pairKey(m.teamA[0], m.teamA[1]))) partnerRepeats++;
    if (history.partnerPairsSeen.has(pairKey(m.teamB[0], m.teamB[1]))) partnerRepeats++;
    for (const a of m.teamA) {
      for (const b of m.teamB) {
        if (history.opponentPairsSeen.has(pairKey(a, b))) opponentRepeats++;
      }
    }
  }
  return { partnerRepeats, opponentRepeats };
}

/**
 * Count-weighted cost of a candidate round (lower = better). Unlike the boolean
 * repeat score, this uses how many times each pair has ALREADY partnered /
 * opposed, so the search actively prefers the least-partnered pairing rather
 * than treating every already-seen pair the same. A pair's partner cost grows
 * with the square of its prior count, so re-partnering someone you've partnered
 * twice hurts far more than pairing someone fresh — that's what stops "3× with
 * Fuad, 0× with Sirhan". Partners are weighted well above opponents.
 */
function pairingCost(matches: Match[], history: MatchHistory): number {
  let cost = 0;
  for (const m of matches) {
    for (const [x, y] of [m.teamA, m.teamB] as [PlayerId, PlayerId][]) {
      const c = history.partnerCounts.get(pairKey(x, y)) ?? 0;
      cost += (c + 1) * (c + 1) * 6; // convex + heavily weighted
    }
    for (const a of m.teamA) {
      for (const b of m.teamB) {
        const c = history.opponentCounts.get(pairKey(a, b)) ?? 0;
        cost += (c + 1) * (c + 1);
      }
    }
  }
  return cost;
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildMatchesFromOrder(order: PlayerId[]): Match[] {
  const matches: Match[] = [];
  for (let i = 0; i + 3 < order.length; i += 4) {
    matches.push({
      courtIndex: -1, // assigned later
      teamA: [order[i], order[i + 1]],
      teamB: [order[i + 2], order[i + 3]],
    });
  }
  return matches;
}

/**
 * Global balance pass over a whole generated schedule (simulated annealing).
 *
 * Per-round greedy can't fix cases like "hamud & gilang never share a round" —
 * because WHO RESTS each round determines who CAN even partner. This search uses
 * two moves that together rebalance both:
 *   1. swap two on-court players within a round (changes partners/opponents),
 *   2. swap an on-court player with a bench player (changes who plays that round).
 * It minimises Σ partnerCount² (primary — spreads partnerships to all-distinct),
 * Σ opponentCount² (secondary), and Σ playCount² (keeps rests fair). Deterministic
 * for a given rng, so the same session always produces the same schedule.
 */
function optimizeAmericano(rounds: RoundResult[], players: PlayerId[], rng: Rng, iterations: number): void {
  const objective = (): number => {
    const pc = new Map<string, number>();
    const oc = new Map<string, number>();
    const play = new Map<string, number>(players.map((p) => [p, 0]));
    for (const r of rounds) {
      for (const m of r.matches) {
        const ak = pairKey(m.teamA[0], m.teamA[1]);
        const bk = pairKey(m.teamB[0], m.teamB[1]);
        pc.set(ak, (pc.get(ak) ?? 0) + 1);
        pc.set(bk, (pc.get(bk) ?? 0) + 1);
        for (const a of m.teamA) {
          play.set(a, (play.get(a) ?? 0) + 1);
          for (const b of m.teamB) {
            const ok = pairKey(a, b);
            oc.set(ok, (oc.get(ok) ?? 0) + 1);
          }
        }
        for (const b of m.teamB) play.set(b, (play.get(b) ?? 0) + 1);
      }
    }
    let f = 0;
    for (const v of pc.values()) f += v * v * 1000;
    for (const v of oc.values()) f += v * v;
    for (const v of play.values()) f += v * v * 60;
    return f;
  };

  let cur = objective();
  const T0 = Math.max(1, cur * 0.03);
  for (let it = 0; it < iterations; it++) {
    const r = rounds[Math.floor(rng() * rounds.length)];
    if (!r || r.matches.length === 0) continue;
    const T = T0 * (1 - it / iterations);
    let revert: (() => void) | null = null;

    if (r.restingIds.length > 0 && rng() < 0.5) {
      // Bench swap: an on-court player trades places with a resting one.
      const m = r.matches[Math.floor(rng() * r.matches.length)];
      const side = rng() < 0.5 ? m.teamA : m.teamB;
      const pos = Math.floor(rng() * 2);
      const bi = Math.floor(rng() * r.restingIds.length);
      const onCourt = side[pos];
      const benched = r.restingIds[bi];
      side[pos] = benched;
      r.restingIds[bi] = onCourt;
      revert = () => {
        side[pos] = onCourt;
        r.restingIds[bi] = benched;
      };
    } else {
      // Team swap: two on-court positions in the round trade players.
      const positions: { arr: PlayerId[]; idx: number }[] = [];
      for (const m of r.matches) {
        positions.push({ arr: m.teamA, idx: 0 }, { arr: m.teamA, idx: 1 }, { arr: m.teamB, idx: 0 }, { arr: m.teamB, idx: 1 });
      }
      if (positions.length < 2) continue;
      const pi = positions[Math.floor(rng() * positions.length)];
      const pj = positions[Math.floor(rng() * positions.length)];
      const a = pi.arr[pi.idx];
      const b = pj.arr[pj.idx];
      if (a === b) continue;
      pi.arr[pi.idx] = b;
      pj.arr[pj.idx] = a;
      revert = () => {
        pi.arr[pi.idx] = a;
        pj.arr[pj.idx] = b;
      };
    }

    const next = objective();
    const delta = next - cur;
    if (delta <= 0 || (T > 0 && rng() < Math.exp(-delta / T))) {
      cur = next;
    } else if (revert) {
      revert();
    }
  }
}

export interface GenerateAmericanoRoundInput {
  activePlayerIds: PlayerId[];
  statsById: Map<PlayerId, PlayerFairnessState>;
  courtsAvailable: number;
  history: MatchHistory;
  rng: Rng;
  /** How many randomized attempts to try when minimizing repeats. */
  tries?: number;
}

export function generateAmericanoRound(input: GenerateAmericanoRoundInput): RoundResult {
  const { activePlayerIds, statsById, courtsAvailable, history, rng, tries = 300 } = input;

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

  // Randomized local search: try many random orderings, keep the one with the
  // lowest COUNT-weighted cost — i.e. the pairing that spreads partners the most
  // evenly against everything seen so far (see pairingCost), not merely the one
  // that avoids the first repeat.
  let best: Match[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let t = 0; t < tries; t++) {
    const order = shuffle(playPool, rng);
    const candidate = buildMatchesFromOrder(order);
    const score = pairingCost(candidate, history);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  const matches = best ?? buildMatchesFromOrder(playPool);

  // Assign courts: spread players away from the court they were on last time
  // where possible (priority 5 in PRD §6/§7 — lowest priority, simple heuristic is fine).
  const courtOrder = shuffle(
    Array.from({ length: courtsUsed }, (_, i) => i),
    rng,
  );
  matches.forEach((m, i) => {
    m.courtIndex = courtOrder[i % courtOrder.length];
  });
  matches.sort((a, b) => a.courtIndex - b.courtIndex);

  const consecutiveRests = hasUnavoidableConsecutiveRest(restingIds, statsById);
  const { partnerRepeats, opponentRepeats } = scorePairing(matches, history);

  const explanationParts = [
    `${playPool.length} of ${activePlayerIds.length} active players are on court this round across ${courtsUsed} court${courtsUsed > 1 ? "s" : ""}.`,
  ];
  if (restingIds.length > 0) {
    explanationParts.push(`${restingIds.length} rest this round, chosen by fewest matches played so far.`);
  }
  if (consecutiveRests.length > 0) {
    explanationParts.push(
      `${consecutiveRests.length} player(s) rest two rounds in a row — unavoidable given the current player/court count.`,
    );
  }
  if (partnerRepeats > 0 || opponentRepeats > 0) {
    explanationParts.push(
      `${partnerRepeats} repeated partnership(s) and ${opponentRepeats} repeated opponent matchup(s) were unavoidable this round.`,
    );
  }

  return {
    courtsUsed,
    matches,
    restingIds,
    explanation: explanationParts.join(" "),
  };
}

export interface GenerateAmericanoScheduleInput {
  activePlayerIds: PlayerId[];
  courtsAvailable: number;
  /** How many rounds to generate up front. */
  roundCount: number;
  /** Same session-level seed used everywhere else; each round is seeded with
   * schedulingSeed + its own 1-based sequence number, matching how a single
   * round is seeded when generated on-demand (see roundActions.ts). */
  schedulingSeed: number;
}

/**
 * Generates the FULL Americano schedule for a session in one call, instead
 * of one round at a time. Americano's fairness and partner/opponent-repeat
 * rules never depend on scores (unlike Mexicano's rank-based pairing), so
 * the whole schedule can be committed the moment the session starts — no
 * "Next Round" button is needed to progress through it later.
 */
export function generateAmericanoSchedule(input: GenerateAmericanoScheduleInput): RoundResult[] {
  const { activePlayerIds, courtsAvailable, roundCount, schedulingSeed } = input;

  const statsById = new Map<PlayerId, PlayerFairnessState>(
    activePlayerIds.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const history: MatchHistory = emptyHistory();
  const rounds: RoundResult[] = [];

  for (let sequence = 1; sequence <= roundCount; sequence++) {
    const rng = mulberry32(schedulingSeed + sequence);
    const result = generateAmericanoRound({ activePlayerIds, statsById, courtsAvailable, history, rng });
    if (result.courtsUsed === 0) break; // not enough players — stop rather than push empty rounds

    rounds.push(result);
    recordRoundInHistory(history, result);

    const playingIds = new Set(result.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    for (const id of activePlayerIds) {
      const s = statsById.get(id)!;
      statsById.set(
        id,
        playingIds.has(id)
          ? { playerId: id, matchesPlayed: s.matchesPlayed + 1, restedLastRound: false }
          : { playerId: id, matchesPlayed: s.matchesPlayed, restedLastRound: true },
      );
    }
  }

  // Global balance pass: jointly rebalances rests + partners so nobody ends up
  // partnering one person repeatedly while never partnering another (the
  // per-round greedy above can't see across rounds). Deterministic seed derived
  // from the session seed so the schedule is stable/reproducible.
  if (rounds.length > 0) {
    const iterations = Math.min(80000, Math.max(8000, rounds.length * activePlayerIds.length * 300));
    optimizeAmericano(rounds, activePlayerIds, mulberry32(schedulingSeed + 99991), iterations);

    // Re-assign courts across each round after the swaps (keeps a stable,
    // low-churn court layout; the optimizer only cares about who-plays-whom).
    for (const r of rounds) r.matches.forEach((m, i) => (m.courtIndex = i));
  }

  return rounds;
}
