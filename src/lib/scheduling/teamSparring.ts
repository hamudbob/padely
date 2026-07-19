// Team Sparring: the whole roster is split into two fixed sides for the
// entire session (players.team_side — 'A' or 'B', assigned at session
// creation). Every match always pits a Team A pair against a Team B pair,
// so a running Team A vs Team B scoreboard is always meaningful — that's
// the whole point of this format and what sets it apart from Fixed Partner
// (no team affiliation, just fixed pairs) and Americano/Mexicano
// (individual, no teams at all).
//
// Partners still ROTATE within each side every round — same fairness
// (who plays vs rests, by matchesPlayed/restedLastRound, never rank) and
// repeat-avoidance rules as Americano — just scaled to a side's own
// half-match unit (2 players, not 4), since a side only ever supplies one
// pair per court. Cross-team opponent repeats are avoided the same way
// Americano avoids them, via the shared MatchHistory/pairKey machinery.
//
// Like Americano, pairing never depends on match scores, so the whole
// schedule can be generated upfront — no "Next Round" button needed.

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

export interface TeamRoster {
  teamA: PlayerId[];
  teamB: PlayerId[];
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Picks who plays vs rests for ONE side. Same fairness rule as
 * Americano/Mexicano (highest matchesPlayed rests first, never rank) —
 * just sized to a side's own half-match unit (2 players per court, since a
 * side only ever supplies one pair per court, never a full match alone).
 */
function selectSidePlayers(
  activeIds: PlayerId[],
  statsById: Map<PlayerId, PlayerFairnessState>,
  courtsUsed: number,
  rng: Rng,
): { playingIds: PlayerId[]; restingIds: PlayerId[] } {
  const playSlots = courtsUsed * 2;
  const restSlots = activeIds.length - playSlots;
  if (restSlots <= 0) return { playingIds: [...activeIds], restingIds: [] };

  const withKeys = activeIds.map((id) => {
    const s = statsById.get(id) ?? { playerId: id, matchesPlayed: 0, restedLastRound: false };
    return { id, matchesPlayed: s.matchesPlayed, restedLastRound: s.restedLastRound, tie: rng() };
  });
  withKeys.sort((a, b) => {
    if (b.matchesPlayed !== a.matchesPlayed) return b.matchesPlayed - a.matchesPlayed;
    if (a.restedLastRound !== b.restedLastRound) return a.restedLastRound ? 1 : -1;
    return b.tie - a.tie;
  });

  const restingIds = withKeys.slice(0, restSlots).map((x) => x.id);
  const restingSet = new Set(restingIds);
  const playingIds = activeIds.filter((id) => !restingSet.has(id));
  return { playingIds, restingIds };
}

function scoreMatchups(matches: Match[], history: MatchHistory): { partnerRepeats: number; opponentRepeats: number } {
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

// teamAOrder always fills Match.teamA and teamBOrder always fills
// Match.teamB — unlike Americano's arbitrary 4-way split, a match's "team"
// slot here is never arbitrary, it's always the roster side it came from.
function buildTeamMatches(teamAOrder: PlayerId[], teamBOrder: PlayerId[]): Match[] {
  const matches: Match[] = [];
  const n = Math.min(teamAOrder.length, teamBOrder.length);
  for (let i = 0; i + 1 < n; i += 2) {
    matches.push({
      courtIndex: -1,
      teamA: [teamAOrder[i], teamAOrder[i + 1]],
      teamB: [teamBOrder[i], teamBOrder[i + 1]],
    });
  }
  return matches;
}

export interface GenerateTeamSparringRoundInput {
  roster: TeamRoster;
  statsById: Map<PlayerId, PlayerFairnessState>;
  courtsAvailable: number;
  history: MatchHistory;
  rng: Rng;
  /** How many randomized attempts to try when minimizing repeats. */
  tries?: number;
}

export function generateTeamSparringRound(input: GenerateTeamSparringRoundInput): RoundResult {
  const { roster, statsById, courtsAvailable, history, rng, tries = 300 } = input;

  // A court needs one pair from EACH side, so whichever side has fewer
  // available players caps how many courts can run this round — same hard
  // rule as every other format (a court only runs if fully staffed).
  const courtsUsed = Math.min(
    Math.max(0, courtsAvailable),
    Math.floor(roster.teamA.length / 2),
    Math.floor(roster.teamB.length / 2),
  );

  if (courtsUsed === 0) {
    return {
      courtsUsed: 0,
      matches: [],
      restingIds: [...roster.teamA, ...roster.teamB],
      explanation: `Not enough players on both teams for a full court (Team A: ${roster.teamA.length}, Team B: ${roster.teamB.length} — need at least 2 on each side per court).`,
    };
  }

  const { playingIds: playingA, restingIds: restingA } = selectSidePlayers(roster.teamA, statsById, courtsUsed, rng);
  const { playingIds: playingB, restingIds: restingB } = selectSidePlayers(roster.teamB, statsById, courtsUsed, rng);

  // Randomized local search: try many random orderings on each side, keep
  // the pairing with the fewest repeated within-team partners / cross-team
  // opponents against history — same approach as Americano's local search.
  let best: Match[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let t = 0; t < tries; t++) {
    const orderA = shuffle(playingA, rng);
    const orderB = shuffle(playingB, rng);
    const candidate = buildTeamMatches(orderA, orderB);
    const { partnerRepeats, opponentRepeats } = scoreMatchups(candidate, history);
    const score = partnerRepeats * 2 + opponentRepeats;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
      if (score === 0) break;
    }
  }
  const matches = best ?? buildTeamMatches(playingA, playingB);

  const courtOrder = shuffle(
    Array.from({ length: courtsUsed }, (_, i) => i),
    rng,
  );
  matches.forEach((m, i) => {
    m.courtIndex = courtOrder[i % courtOrder.length];
  });
  matches.sort((a, b) => a.courtIndex - b.courtIndex);

  const restingIds = [...restingA, ...restingB];
  const { partnerRepeats, opponentRepeats } = scoreMatchups(matches, history);

  const explanationParts = [
    `${matches.length * 2} of ${roster.teamA.length + roster.teamB.length} active players are on court this round across ${courtsUsed} court${courtsUsed > 1 ? "s" : ""} — Team A vs Team B on every court.`,
  ];
  if (restingIds.length > 0) {
    explanationParts.push(`${restingIds.length} rest this round, chosen by fewest matches played so far on their own side.`);
  }
  if (partnerRepeats > 0 || opponentRepeats > 0) {
    explanationParts.push(
      `${partnerRepeats} repeated within-team partnership(s) and ${opponentRepeats} repeated cross-team matchup(s) were unavoidable this round.`,
    );
  }

  return {
    courtsUsed,
    matches,
    restingIds,
    explanation: explanationParts.join(" "),
  };
}

export interface GenerateTeamSparringScheduleInput {
  roster: TeamRoster;
  courtsAvailable: number;
  /** How many rounds to generate up front. */
  roundCount: number;
  /** Same session-level seed used everywhere else; each round is seeded with
   * schedulingSeed + its own 1-based sequence number, matching Americano. */
  schedulingSeed: number;
}

/**
 * Generates the FULL Team Sparring schedule for a session in one call —
 * same rationale as generateAmericanoSchedule: pairing never depends on
 * scores, so there's no need to gate progress on a "Next Round" button.
 */
export function generateTeamSparringSchedule(input: GenerateTeamSparringScheduleInput): RoundResult[] {
  const { roster, courtsAvailable, roundCount, schedulingSeed } = input;
  const allIds = [...roster.teamA, ...roster.teamB];

  const statsById = new Map<PlayerId, PlayerFairnessState>(
    allIds.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const history: MatchHistory = emptyHistory();
  const rounds: RoundResult[] = [];

  for (let sequence = 1; sequence <= roundCount; sequence++) {
    const rng = mulberry32(schedulingSeed + sequence);
    const result = generateTeamSparringRound({ roster, statsById, courtsAvailable, history, rng });
    if (result.courtsUsed === 0) break; // not enough players on one/both sides — stop rather than push empty rounds

    rounds.push(result);
    recordRoundInHistory(history, result);

    const playingIds = new Set(result.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    for (const id of allIds) {
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
