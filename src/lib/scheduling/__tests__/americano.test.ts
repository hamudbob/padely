import { describe, it, expect } from "vitest";
import { mulberry32, PlayerFairnessState, emptyHistory, recordRoundInHistory } from "../types";
import { generateAmericanoRound } from "../americano";

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => `P${i + 1}`);
}

function runSimulation(playerCount: number, courts: number, rounds: number, seed: number) {
  const players = makePlayers(playerCount);
  const stats = new Map<string, PlayerFairnessState>(
    players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const rng = mulberry32(seed);
  const history = emptyHistory();
  const results = [];

  for (let round = 0; round < rounds; round++) {
    const result = generateAmericanoRound({
      activePlayerIds: players,
      statsById: stats,
      courtsAvailable: courts,
      history,
      rng,
    });
    recordRoundInHistory(history, result);
    results.push(result);

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
  return { stats, players, results, history };
}

describe("Americano scheduling", () => {
  it("keeps matches-played spread <= 1 across rounds", () => {
    const { stats, players } = runSimulation(11, 2, 10, 99);
    const played = players.map((id) => stats.get(id)!.matchesPlayed);
    expect(Math.max(...played) - Math.min(...played)).toBeLessThanOrEqual(1);
  });

  it("achieves zero repeated partners for the ideal case (8 players, 2 courts, 7 rounds)", () => {
    // 8 players can form a full round-robin of unique partnerships in exactly 7 rounds.
    const { history } = runSimulation(8, 2, 7, 5);
    // every one of C(8,2)=28 partner pairs should appear at most once — since we
    // recorded 7 rounds x 2 matches x 2 pairs = 28 partner-pair placements total,
    // zero repeats means all 28 are unique.
    const totalPartnerPlacements = 7 * 2 * 2;
    expect(history.partnerPairsSeen.size).toBe(totalPartnerPlacements);
  });

  it("never double-books a player or a court within a round", () => {
    const players = makePlayers(13);
    const stats = new Map<string, PlayerFairnessState>(
      players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const result = generateAmericanoRound({
      activePlayerIds: players,
      statsById: stats,
      courtsAvailable: 3,
      history: emptyHistory(),
      rng: mulberry32(11),
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
    // 13 players, 3 courts -> floor(13/4)=3 courts used, 12 play, 1 rests
    expect(result.courtsUsed).toBe(3);
    expect(result.restingIds.length).toBe(1);
  });
});
