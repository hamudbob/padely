import { describe, it, expect } from "vitest";
import { mulberry32, PlayerFairnessState, emptyHistory, recordRoundInHistory, pairKey } from "../types";
import { generateAmericanoRound, generateAmericanoSchedule } from "../americano";

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

// Regression for the reported "3× with one partner, 0× with another" imbalance
// on a 7-player, single-court night. Count-weighted pairing should spread
// partnerships evenly instead of only avoiding the first repeat.
describe("Americano partner balance (7 players, 1 court)", () => {
  const players = makePlayers(7);
  // 10 rounds = 20 partnerships; the clean optimum covers 20 of the 21 possible
  // pairs exactly once with ZERO repeats (matching a known-good reference).
  const rounds = generateAmericanoSchedule({
    activePlayerIds: players,
    courtsAvailable: 1,
    roundCount: 10,
    schedulingSeed: 42,
  });

  it("generates 10 rounds of one match each, no player twice per round", () => {
    expect(rounds.length).toBe(10);
    for (const r of rounds) {
      expect(r.matches.length).toBe(1);
      const ids = r.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("rests players fairly (rest counts differ by at most 1)", () => {
    const rest = new Map<string, number>(players.map((p) => [p, 0]));
    for (const r of rounds) for (const id of r.restingIds) rest.set(id, (rest.get(id) ?? 0) + 1);
    const counts = [...rest.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("spreads partnerships to near-optimal — almost no repeats, broad coverage", () => {
    const partner = new Map<string, number>();
    for (const r of rounds) {
      for (const m of r.matches) {
        for (const [a, b] of [m.teamA, m.teamB]) {
          const k = pairKey(a, b);
          partner.set(k, (partner.get(k) ?? 0) + 1);
        }
      }
    }
    const max = Math.max(...partner.values());
    const distinct = partner.size; // of C(7,2) = 21
    const repeats = [...partner.values()].reduce((s, c) => s + (c - 1), 0);
    // Old greedy: pairs at 3 while others never met (17 distinct, ~5 repeats).
    // The global optimizer should reach the reference's near-1-factorization.
    expect(max).toBeLessThanOrEqual(2);
    expect(distinct).toBeGreaterThanOrEqual(19);
    expect(repeats).toBeLessThanOrEqual(2);
  });
});
