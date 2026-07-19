import { describe, it, expect } from "vitest";
import { mulberry32, emptyHistory, PlayerFairnessState, PlayerId } from "../types";
import { generateMixAmericanoRound, generateMixAmericanoSchedule, Gender } from "../mixAmericano";

function makeRoster(men: number, women: number) {
  const players: PlayerId[] = [];
  const genderById = new Map<PlayerId, Gender>();
  for (let i = 0; i < men; i++) {
    const id = `M${i + 1}`;
    players.push(id);
    genderById.set(id, "M");
  }
  for (let i = 0; i < women; i++) {
    const id = `F${i + 1}`;
    players.push(id);
    genderById.set(id, "F");
  }
  return { players, genderById };
}

describe("Mix Americano scheduling", () => {
  it("mixes every team when the roster splits evenly (4M/4F, 2 courts)", () => {
    const { players, genderById } = makeRoster(4, 4);
    const schedule = generateMixAmericanoSchedule({
      activePlayerIds: players,
      genderById,
      courtsAvailable: 2,
      roundCount: 4,
      schedulingSeed: 1,
    });
    expect(schedule.length).toBe(4);
    for (const round of schedule) {
      for (const m of round.matches) {
        expect(genderById.get(m.teamA[0])).not.toBe(genderById.get(m.teamA[1]));
        expect(genderById.get(m.teamB[0])).not.toBe(genderById.get(m.teamB[1]));
      }
    }
  });

  it("best-effort: mixes as many teams as the gender split allows (5M/3F, 2 courts)", () => {
    const { players, genderById } = makeRoster(5, 3);
    const stats = new Map<PlayerId, PlayerFairnessState>(
      players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const result = generateMixAmericanoRound({
      activePlayerIds: players,
      genderById,
      statsById: stats,
      courtsAvailable: 2,
      history: emptyHistory(),
      rng: mulberry32(99),
    });
    expect(result.matches.length).toBe(2);
    let mixedCount = 0;
    for (const m of result.matches) {
      if (genderById.get(m.teamA[0]) !== genderById.get(m.teamA[1])) mixedCount++;
      if (genderById.get(m.teamB[0]) !== genderById.get(m.teamB[1])) mixedCount++;
    }
    // Only 3 women for 4 team-slots — at most 3 teams can be mixed, never a crash
    // or a refusal to generate a round over an imperfect split.
    expect(mixedCount).toBe(3);
  });

  it("still keeps the underlying fairness/rotation rules (no double-booking, matches-played spread <= 1)", () => {
    const { players, genderById } = makeRoster(6, 5); // 11 players
    const stats = new Map<PlayerId, PlayerFairnessState>(
      players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const rng = mulberry32(20);
    const history = emptyHistory();
    for (let round = 0; round < 10; round++) {
      const result = generateMixAmericanoRound({
        activePlayerIds: players,
        genderById,
        statsById: stats,
        courtsAvailable: 2,
        history,
        rng,
      });
      const seen = new Set<string>();
      for (const m of result.matches) {
        for (const p of [...m.teamA, ...m.teamB]) {
          expect(seen.has(p)).toBe(false);
          seen.add(p);
        }
      }
      const playingSet = new Set(result.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
      for (const id of players) {
        const s = stats.get(id)!;
        stats.set(
          id,
          playingSet.has(id)
            ? { playerId: id, matchesPlayed: s.matchesPlayed + 1, restedLastRound: false }
            : { playerId: id, matchesPlayed: s.matchesPlayed, restedLastRound: true },
        );
      }
    }
    const played = players.map((id) => stats.get(id)!.matchesPlayed);
    expect(Math.max(...played) - Math.min(...played)).toBeLessThanOrEqual(1);
  });
});
