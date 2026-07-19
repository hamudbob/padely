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
  // fewest repeated partners (weighted higher) / opponents against history.
  let best: Match[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let t = 0; t < tries; t++) {
    const order = shuffle(playPool, rng);
    const candidate = buildMatchesFromOrder(order);
    const { partnerRepeats, opponentRepeats } = scorePairing(candidate, history);
    const score = partnerRepeats * 2 + opponentRepeats;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
      if (score === 0) break;
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

  return rounds;
}
