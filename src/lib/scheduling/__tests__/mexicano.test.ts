import { describe, it, expect } from "vitest";
import { mulberry32, PlayerFairnessState, recordRoundInHistory, emptyHistory } from "../types";
import { generateMexicanoRound, StandingLookup } from "../mexicano";

/**
 * This is the regression test for the exact bug the old app had: with 12
 * players and 2 courts, the bottom-ranked group must NOT be stuck resting
 * every round. After many rounds, everyone's matches-played count must stay
 * within 1 of everyone else's, regardless of who is winning.
 */
function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => `P${i + 1}`);
}

function runSimulation(playerCount: number, courts: number, rounds: number, seed: number) {
  const players = makePlayers(playerCount);
  const stats = new Map<string, PlayerFairnessState>(
    players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const points = new Map<string, number>(players.map((id) => [id, 0]));
  const rng = mulberry32(seed);
  const standings: StandingLookup = { rankValue: (id) => points.get(id) ?? 0 };
  const history = emptyHistory();

  for (let round = 0; round < rounds; round++) {
    const result = generateMexicanoRound({
      activePlayerIds: players,
      statsById: stats,
      courtsAvailable: courts,
      standings,
      isFirstRound: round === 0,
      rng,
    });
    recordRoundInHistory(history, result);

    // simulate a plausible result per match: team with the better combined
    // "skill" (here just seeded random) wins 15-8, loser still gets points
    for (const m of result.matches) {
      const aWins = rng() < 0.5;
      const [aScore, bScore] = aWins ? [15, 8] : [8, 15];
      for (const p of m.teamA) points.set(p, (points.get(p) ?? 0) + aScore);
      for (const p of m.teamB) points.set(p, (points.get(p) ?? 0) + bScore);
    }

    // update fairness state for next round
    const playingSet = new Set(result.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    for (const id of players) {
      const s = stats.get(id)!;
      if (playingSet.has(id)) {
        stats.set(id, { playerId: id, matchesPlayed: s.matchesPlayed + 1, restedLastRound: false });
      } else {
        stats.set(id, { playerId: id, matchesPlayed: s.matchesPlayed, restedLastRound: true });
      }
    }
  }

  return { stats, players };
}

describe("Mexicano fairness (regression test for the old app's bug)", () => {
  it("keeps matches-played spread <= 1 for 12 players / 2 courts over 8 rounds", () => {
    const { stats, players } = runSimulation(12, 2, 8, 42);
    const played = players.map((id) => stats.get(id)!.matchesPlayed);
    expect(Math.max(...played) - Math.min(...played)).toBeLessThanOrEqual(1);
  });

  it.each([
    [5, 1],
    [8, 2],
    [11, 2],
    [12, 2],
    [12, 3],
    [17, 4],
  ])("keeps matches-played spread <= 1 for %i players / %i courts over 10 rounds", (n, courts) => {
    const { stats, players } = runSimulation(n, courts, 10, n * 1000 + courts);
    const played = players.map((id) => stats.get(id)!.matchesPlayed);
    expect(Math.max(...played) - Math.min(...played)).toBeLessThanOrEqual(1);
  });

  it("never plays a player twice in the same round and never double-books a court", () => {
    const { players } = runSimulation(12, 2, 1, 7);
    const players12 = makePlayers(12);
    const stats = new Map<string, PlayerFairnessState>(
      players12.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const standings: StandingLookup = { rankValue: () => 0 };
    const result = generateMexicanoRound({
      activePlayerIds: players12,
      statsById: stats,
      courtsAvailable: 2,
      standings,
      isFirstRound: true,
      rng: mulberry32(1),
    });
    const seen = new Set<string>();
    const courts = new Set<number>();
    for (const m of result.matches) {
      for (const p of [...m.teamA, ...m.teamB]) {
        expect(seen.has(p)).toBe(false);
        seen.add(p);
      }
      expect(courts.has(m.courtIndex)).toBe(false);
      courts.add(m.courtIndex);
    }
    expect(players).toBeDefined();
  });

  it("round 1 groups purely by seed (no standings yet), later rounds group by rank", () => {
    const players12 = makePlayers(12);
    const stats = new Map<string, PlayerFairnessState>(
      players12.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    // rank player P1 highest, P12 lowest
    const points = new Map<string, number>(players12.map((id, i) => [id, (12 - i) * 10]));
    const standings: StandingLookup = { rankValue: (id) => points.get(id) ?? 0 };

    const result = generateMexicanoRound({
      activePlayerIds: players12,
      statsById: stats,
      courtsAvailable: 3,
      standings,
      isFirstRound: false,
      rng: mulberry32(3),
    });
    // top group should be the 4 highest-ranked players (P1-P4) since all are
    // selected to play (12 players, 3 courts = 12 slots, nobody rests)
    const topGroupPlayers = new Set([...result.matches[0].teamA, ...result.matches[0].teamB]);
    expect(topGroupPlayers).toEqual(new Set(["P1", "P2", "P3", "P4"]));
  });
});
