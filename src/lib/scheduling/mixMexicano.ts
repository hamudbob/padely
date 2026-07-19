// Mix Mexicano: Mexicano's exact two-step algorithm (see mexicano.ts) —
// WHO plays is still pure playing-time fairness, never rank, never gender.
// HOW they pair still starts from the same "nearby-rank groups of 4" rule —
// we do NOT reshuffle players across rank groups to chase a better gender
// mix, since that would trade away the whole point of Mexicano (keeping
// matches competitive by rank). The only thing added is: WITHIN each
// already-formed group of 4, pick whichever of the 3 possible 2v2 splits
// keeps both teams gender-mixed, if the group's own men/women count allows
// it (falls back to the standard rank1+rank4 vs rank2+rank3 split when a
// group isn't a clean 2-and-2 split, or when it doesn't matter).
//
// Because Mexicano's pairing depends on live standings (except round 1),
// Mix Mexicano stays round-by-round like plain Mexicano — no upfront
// full-schedule generation the way Americano/Team Sparring/Fixed Partner/
// Mix Americano get, since later rounds literally can't be computed until
// earlier ones are scored.

import { Match, PlayerFairnessState, PlayerId, RoundResult, Rng } from "./types";
import { selectPlayersForRound, hasUnavoidableConsecutiveRest } from "./fairness";

export type Gender = "M" | "F";

export interface StandingLookup {
  /** Current points or wins (whatever the session's ranking_basis is) — higher is better. */
  rankValue(playerId: PlayerId): number;
}

function isMixedTeam(team: [PlayerId, PlayerId], genderById: Map<PlayerId, Gender>): boolean {
  const a = genderById.get(team[0]);
  const b = genderById.get(team[1]);
  return !!a && !!b && a !== b;
}

/**
 * Of the 3 ways to split a ranked group of 4 into two teams of 2, picks the
 * one with the most gender-mixed teams. Ties (including "no split can mix
 * anyone" and "every split mixes the same amount") resolve to the standard
 * rank1+rank4 vs rank2+rank3 split, since that's evaluated first and ties
 * don't replace it — keeps Mix Mexicano identical to plain Mexicano whenever
 * gender doesn't give it a reason to differ.
 */
function bestGenderSplit(
  group: [PlayerId, PlayerId, PlayerId, PlayerId],
  genderById: Map<PlayerId, Gender>,
): { teamA: [PlayerId, PlayerId]; teamB: [PlayerId, PlayerId] } {
  const [a, b, c, d] = group;
  const candidates: [[PlayerId, PlayerId], [PlayerId, PlayerId]][] = [
    [
      [a, d],
      [b, c],
    ], // default: rank1+rank4 vs rank2+rank3
    [
      [a, b],
      [c, d],
    ],
    [
      [a, c],
      [b, d],
    ],
  ];
  let best = candidates[0];
  let bestMixedCount = -1;
  for (const candidate of candidates) {
    const [teamA, teamB] = candidate;
    const mixedCount = (isMixedTeam(teamA, genderById) ? 1 : 0) + (isMixedTeam(teamB, genderById) ? 1 : 0);
    if (mixedCount > bestMixedCount) {
      bestMixedCount = mixedCount;
      best = candidate;
    }
  }
  return { teamA: best[0], teamB: best[1] };
}

export interface GenerateMixMexicanoRoundInput {
  activePlayerIds: PlayerId[];
  genderById: Map<PlayerId, Gender>;
  statsById: Map<PlayerId, PlayerFairnessState>;
  courtsAvailable: number;
  standings: StandingLookup;
  /** True only for round 1 (or whenever nobody has a meaningful standing yet). */
  isFirstRound: boolean;
  rng: Rng;
  /** Round-1-only: how many randomized groupings to try when maximizing gender mixing. */
  tries?: number;
}

export function generateMixMexicanoRound(input: GenerateMixMexicanoRoundInput): RoundResult {
  const { activePlayerIds, genderById, statsById, courtsAvailable, standings, isFirstRound, rng, tries = 300 } = input;

  // STEP 1 — who plays. Identical fairness rule as every other format here;
  // rank and gender play no part.
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

  // STEP 2 — how they pair up. Rank the PLAYING subset only (never the
  // resters), then within each nearby-rank group of 4, pick the gender-mixed
  // split when the group's own M/F count allows one.
  //
  // Round 1 is the one place this format has real freedom over WHO ends up
  // in which group of 4 — nobody has a standing yet, so unlike every later
  // round there's no real rank order being protected. A single random
  // shuffle can easily land an unlucky 3-and-1 split in one group and a
  // 1-and-3 in another even when the whole roster is a clean 4M4F, so round
  // 1 runs the same kind of local search Mix Americano uses: try several
  // random groupings and keep whichever produces the fewest non-mixed teams
  // once each group's own best split is applied.
  let ranked: PlayerId[];
  if (isFirstRound) {
    let best = shuffleDeterministic(playPool, rng);
    let bestNonMixed = countNonMixedForGrouping(best, genderById);
    for (let t = 1; t < tries && bestNonMixed > 0; t++) {
      const candidate = shuffleDeterministic(playPool, rng);
      const nonMixed = countNonMixedForGrouping(candidate, genderById);
      if (nonMixed < bestNonMixed) {
        best = candidate;
        bestNonMixed = nonMixed;
      }
    }
    ranked = best;
  } else {
    ranked = [...playPool].sort((a, b) => standings.rankValue(b) - standings.rankValue(a));
  }

  const matches: Match[] = [];
  for (let i = 0; i + 3 < ranked.length; i += 4) {
    const group = ranked.slice(i, i + 4) as [PlayerId, PlayerId, PlayerId, PlayerId];
    const { teamA, teamB } = bestGenderSplit(group, genderById);
    matches.push({ courtIndex: Math.floor(i / 4), teamA, teamB });
  }

  const consecutiveRests = hasUnavoidableConsecutiveRest(restingIds, statsById);
  const nonMixedTeams = matches.reduce(
    (n, m) => n + (isMixedTeam(m.teamA, genderById) ? 0 : 1) + (isMixedTeam(m.teamB, genderById) ? 0 : 1),
    0,
  );

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
  if (nonMixedTeams > 0) {
    explanationParts.push(
      `${nonMixedTeams} team(s) couldn't be gender-mixed this round — their rank group wasn't a clean 2-and-2 men/women split.`,
    );
  }
  explanationParts.push(
    isFirstRound
      ? "Round 1 pairing is randomized (deterministic session seed) since nobody has a standing yet, then mixed for gender where possible."
      : "Players on court are grouped into nearby-rank groups of 4 based on current standings, then paired to keep each team gender-mixed whenever that group's men/women split allows it.",
  );

  return { courtsUsed, matches, restingIds, explanation: explanationParts.join(" ") };
}

/** Total non-mixed teams if `order` were sliced into consecutive groups of 4
 * and each group given its own best gender split — used by round 1's local
 * search to compare candidate groupings against each other. */
function countNonMixedForGrouping(order: PlayerId[], genderById: Map<PlayerId, Gender>): number {
  let nonMixed = 0;
  for (let i = 0; i + 3 < order.length; i += 4) {
    const group = order.slice(i, i + 4) as [PlayerId, PlayerId, PlayerId, PlayerId];
    const { teamA, teamB } = bestGenderSplit(group, genderById);
    if (!isMixedTeam(teamA, genderById)) nonMixed++;
    if (!isMixedTeam(teamB, genderById)) nonMixed++;
  }
  return nonMixed;
}

function shuffleDeterministic<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
