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

  /**
   * The case that made MAX_PLAY_GAP necessary, and the one that hurt most.
   *
   * 8M/4F on two courts: a perfectly mixed pool is 4M/4F, so ALL FOUR women are
   * on court every single round while the men take turns. Twenty rounds of that
   * left a spread of 10 — four people who never once sat down, and men who
   * played half the night. Perfect mixing every round IS that outcome; it isn't
   * a scheduling mistake, it's arithmetic, which is why it needed a cap rather
   * than a fix.
   *
   * The price is visible and accepted: about 30% of teams here are same-gender.
   */
  it("caps the damage on a lopsided roster: nobody drifts more than one game ahead (8M/4F, 2 courts, 20 rounds)", () => {
    const { players, genderById } = makeRoster(8, 4);
    const stats = new Map<PlayerId, PlayerFairnessState>(
      players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const rng = mulberry32(404);
    const history = emptyHistory();
    for (let round = 0; round < 20; round++) {
      const result = generateMixAmericanoRound({
        activePlayerIds: players,
        genderById,
        statsById: stats,
        courtsAvailable: 2,
        history,
        rng,
      });
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
      // Every round, not just at the end — the old behaviour drifted steadily,
      // so a check only at the finish would let an interim blowout through.
      const running = players.map((id) => stats.get(id)!.matchesPlayed);
      expect(Math.max(...running) - Math.min(...running)).toBeLessThanOrEqual(1);
    }
  });

  /**
   * The cap must be invisible when the roster can satisfy both goals. An even
   * split never needs a swap that widens the spread, so nothing changes.
   */
  it("an evenly split roster is untouched by the cap — still every team mixed (6M/6F, 3 courts, 12 rounds)", () => {
    const { players, genderById } = makeRoster(6, 6);
    const stats = new Map<PlayerId, PlayerFairnessState>(
      players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const rng = mulberry32(1234);
    const history = emptyHistory();
    for (let round = 0; round < 12; round++) {
      const result = generateMixAmericanoRound({
        activePlayerIds: players,
        genderById,
        statsById: stats,
        courtsAvailable: 3,
        history,
        rng,
      });
      for (const m of result.matches) {
        expect(genderById.get(m.teamA[0])).not.toBe(genderById.get(m.teamA[1]));
        expect(genderById.get(m.teamB[0])).not.toBe(genderById.get(m.teamB[1]));
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
  });
});
