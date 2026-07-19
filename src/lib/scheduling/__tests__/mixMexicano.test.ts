import { describe, it, expect } from "vitest";
import { mulberry32, PlayerFairnessState, PlayerId } from "../types";
import { generateMixMexicanoRound, Gender } from "../mixMexicano";

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

describe("Mix Mexicano scheduling", () => {
  it("round 1 (no standings yet) mixes every team when the roster is 4M/4F", () => {
    const { players, genderById } = makeRoster(4, 4);
    const stats = new Map<PlayerId, PlayerFairnessState>(
      players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const standings = { rankValue: () => 0 };
    const round1 = generateMixMexicanoRound({
      activePlayerIds: players,
      genderById,
      statsById: stats,
      courtsAvailable: 2,
      standings,
      isFirstRound: true,
      rng: mulberry32(5),
    });
    expect(round1.matches.length).toBe(2);
    for (const m of round1.matches) {
      expect(genderById.get(m.teamA[0])).not.toBe(genderById.get(m.teamA[1]));
      expect(genderById.get(m.teamB[0])).not.toBe(genderById.get(m.teamB[1]));
    }
  });

  it("falls back to the rank1+rank4 vs rank2+rank3 split when a rank group can't be gender-mixed (3M/1F)", () => {
    const players: PlayerId[] = ["m1", "m2", "m3", "f1"];
    const genderById = new Map<PlayerId, Gender>([
      ["m1", "M"],
      ["m2", "M"],
      ["m3", "M"],
      ["f1", "F"],
    ]);
    const stats = new Map<PlayerId, PlayerFairnessState>(
      players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const rankVals: Record<string, number> = { m1: 4, m2: 3, m3: 2, f1: 1 };
    const standings = { rankValue: (id: PlayerId) => rankVals[id] };
    const round = generateMixMexicanoRound({
      activePlayerIds: players,
      genderById,
      statsById: stats,
      courtsAvailable: 1,
      standings,
      isFirstRound: false,
      rng: mulberry32(6),
    });
    expect(round.matches.length).toBe(1);
    const m = round.matches[0];
    // rank1=m1, rank4=f1 should be teamed together (the standard default split)
    const rank1And4Together =
      (m.teamA.includes("m1") && m.teamA.includes("f1")) || (m.teamB.includes("m1") && m.teamB.includes("f1"));
    expect(rank1And4Together).toBe(true);
  });

  it("keeps rank-grouping (which 4 players form a group) untouched by the gender constraint", () => {
    const { players, genderById } = makeRoster(4, 4); // 8 players, alternating gender assignment below
    const genderById2 = new Map<PlayerId, Gender>(players.map((id, i) => [id, i % 2 === 0 ? "M" : "F"]));
    const stats = new Map<PlayerId, PlayerFairnessState>(
      players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const rankVals: Record<string, number> = {};
    players.forEach((id, i) => (rankVals[id] = 100 - i)); // players[0] highest rank ... players[7] lowest
    const standings = { rankValue: (id: PlayerId) => rankVals[id] };
    const round = generateMixMexicanoRound({
      activePlayerIds: players,
      genderById: genderById2,
      statsById: stats,
      courtsAvailable: 2,
      standings,
      isFirstRound: false,
      rng: mulberry32(7),
    });
    const top4 = new Set(players.slice(0, 4));
    const bottom4 = new Set(players.slice(4, 8));
    const court0 = new Set([...round.matches[0].teamA, ...round.matches[0].teamB]);
    const court1 = new Set([...round.matches[1].teamA, ...round.matches[1].teamB]);
    const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
    const groupsMatchExpected =
      (setsEqual(court0, top4) && setsEqual(court1, bottom4)) || (setsEqual(court0, bottom4) && setsEqual(court1, top4));
    expect(groupsMatchExpected).toBe(true);
  });

  it("same seed produces an identical round 1 (deterministic)", () => {
    const { players, genderById } = makeRoster(4, 4);
    const standings = { rankValue: () => 0 };
    const runOnce = () => {
      const stats = new Map<PlayerId, PlayerFairnessState>(
        players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
      );
      return generateMixMexicanoRound({
        activePlayerIds: players,
        genderById,
        statsById: stats,
        courtsAvailable: 2,
        standings,
        isFirstRound: true,
        rng: mulberry32(42),
      });
    };
    expect(JSON.stringify(runOnce().matches)).toBe(JSON.stringify(runOnce().matches));
  });
});
