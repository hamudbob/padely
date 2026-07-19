// Mix Americano: identical rotation/fairness rules to plain Americano
// (partners AND opponents rotate every round; who rests is decided purely by
// fewest-matches-played, same as every other format here — never by gender)
// with one extra optimization goal layered onto the local search: every team
// should be one man + one woman.
//
// Gender-mixing is the TOP-priority term in the scoring function — it's the
// entire point of this format — ranked above partner-repeat and
// opponent-repeat avoidance. It's a heavily-weighted preference, not a hard
// rule: if the group playing this round has an uneven M/F split (or the
// whole session does), the search still returns its best available
// arrangement instead of refusing to generate a round — best-effort, same
// as the tie-handling philosophy used elsewhere in this app.

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

export type Gender = "M" | "F";

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

function isMixedTeam(team: [PlayerId, PlayerId], genderById: Map<PlayerId, Gender>): boolean {
  const a = genderById.get(team[0]);
  const b = genderById.get(team[1]);
  return !!a && !!b && a !== b;
}

function scoreArrangement(
  matches: Match[],
  history: MatchHistory,
  genderById: Map<PlayerId, Gender>,
): { nonMixedTeams: number; partnerRepeats: number; opponentRepeats: number } {
  let nonMixedTeams = 0;
  let partnerRepeats = 0;
  let opponentRepeats = 0;
  for (const m of matches) {
    if (!isMixedTeam(m.teamA, genderById)) nonMixedTeams++;
    if (!isMixedTeam(m.teamB, genderById)) nonMixedTeams++;
    if (history.partnerPairsSeen.has(pairKey(m.teamA[0], m.teamA[1]))) partnerRepeats++;
    if (history.partnerPairsSeen.has(pairKey(m.teamB[0], m.teamB[1]))) partnerRepeats++;
    for (const a of m.teamA) {
      for (const b of m.teamB) {
        if (history.opponentPairsSeen.has(pairKey(a, b))) opponentRepeats++;
      }
    }
  }
  return { nonMixedTeams, partnerRepeats, opponentRepeats };
}

export interface GenerateMixAmericanoRoundInput {
  activePlayerIds: PlayerId[];
  /** M/F per player — a player missing from this map can't be mixed against,
   * so an arrangement involving them just never scores as "mixed" for that
   * team (safe default, never throws). */
  genderById: Map<PlayerId, Gender>;
  statsById: Map<PlayerId, PlayerFairnessState>;
  courtsAvailable: number;
  history: MatchHistory;
  rng: Rng;
  /** How many randomized attempts to try when minimizing repeats/non-mixed teams. */
  tries?: number;
}

export function generateMixAmericanoRound(input: GenerateMixAmericanoRoundInput): RoundResult {
  const { activePlayerIds, genderById, statsById, courtsAvailable, history, rng, tries = 300 } = input;

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

  // Randomized local search, same shape as plain Americano's, but gender
  // mixing dominates the score (x100) so the search exhausts every chance
  // to fix a non-mixed team before it starts trading off partner/opponent
  // repeats against each other.
  let best: Match[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let t = 0; t < tries; t++) {
    const order = shuffle(playPool, rng);
    const candidate = buildMatchesFromOrder(order);
    const { nonMixedTeams, partnerRepeats, opponentRepeats } = scoreArrangement(candidate, history, genderById);
    const score = nonMixedTeams * 100 + partnerRepeats * 2 + opponentRepeats;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
      if (score === 0) break;
    }
  }
  const matches = best ?? buildMatchesFromOrder(playPool);

  const courtOrder = shuffle(
    Array.from({ length: courtsUsed }, (_, i) => i),
    rng,
  );
  matches.forEach((m, i) => {
    m.courtIndex = courtOrder[i % courtOrder.length];
  });
  matches.sort((a, b) => a.courtIndex - b.courtIndex);

  const consecutiveRests = hasUnavoidableConsecutiveRest(restingIds, statsById);
  const { nonMixedTeams, partnerRepeats, opponentRepeats } = scoreArrangement(matches, history, genderById);

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
  if (nonMixedTeams > 0) {
    explanationParts.push(
      `${nonMixedTeams} team(s) couldn't be gender-mixed this round — not enough of one gender among today's players.`,
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

export interface GenerateMixAmericanoScheduleInput {
  activePlayerIds: PlayerId[];
  genderById: Map<PlayerId, Gender>;
  courtsAvailable: number;
  roundCount: number;
  schedulingSeed: number;
}

/**
 * Generates the FULL Mix Americano schedule up front, same reasoning as
 * plain Americano: nothing about pairing (including the gender-mix
 * preference) depends on scores, so the whole thing can be committed the
 * moment the session starts.
 */
export function generateMixAmericanoSchedule(input: GenerateMixAmericanoScheduleInput): RoundResult[] {
  const { activePlayerIds, genderById, courtsAvailable, roundCount, schedulingSeed } = input;

  const statsById = new Map<PlayerId, PlayerFairnessState>(
    activePlayerIds.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const history: MatchHistory = emptyHistory();
  const rounds: RoundResult[] = [];

  for (let sequence = 1; sequence <= roundCount; sequence++) {
    const rng = mulberry32(schedulingSeed + sequence);
    const result = generateMixAmericanoRound({ activePlayerIds, genderById, statsById, courtsAvailable, history, rng });
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
