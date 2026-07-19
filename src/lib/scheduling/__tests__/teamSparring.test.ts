import { describe, it, expect } from "vitest";
import { generateTeamSparringSchedule, generateTeamSparringRound, TeamRoster } from "../teamSparring";
import { mulberry32, PlayerFairnessState, emptyHistory } from "../types";

function makeSide(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

describe("Team Sparring scheduling", () => {
  it("every match is a real Team A player pair vs a real Team B player pair", () => {
    const teamA = makeSide("a", 4);
    const teamB = makeSide("b", 4);
    const rounds = generateTeamSparringSchedule({
      roster: { teamA, teamB },
      courtsAvailable: 2,
      roundCount: 3,
      schedulingSeed: 42,
    });
    for (const r of rounds) {
      for (const m of r.matches) {
        for (const p of m.teamA) expect(teamA.includes(p)).toBe(true);
        for (const p of m.teamB) expect(teamB.includes(p)).toBe(true);
      }
    }
  });

  it("achieves zero repeated within-team partners for the ideal case (4v4, 2 courts, 3 rounds)", () => {
    // Each side has C(4,2)=6 unique partnerships; 3 rounds x 2 courts = 6
    // pair-placements per side, so zero repeats means all 6 are unique.
    const teamA = makeSide("a", 4);
    const teamB = makeSide("b", 4);
    const rounds = generateTeamSparringSchedule({
      roster: { teamA, teamB },
      courtsAvailable: 2,
      roundCount: 3,
      schedulingSeed: 7,
    });
    const partnerSeen = new Set<string>();
    let repeats = 0;
    for (const r of rounds) {
      for (const m of r.matches) {
        const k1 = [...m.teamA].sort().join("|");
        const k2 = [...m.teamB].sort().join("|");
        if (partnerSeen.has(k1)) repeats++;
        if (partnerSeen.has(k2)) repeats++;
        partnerSeen.add(k1);
        partnerSeen.add(k2);
      }
    }
    expect(repeats).toBe(0);
  });

  it("caps courtsUsed by whichever side has fewer available players", () => {
    const teamA = makeSide("a", 6);
    const teamB = makeSide("b", 4); // only enough for 2 courts (floor(4/2))
    const rounds = generateTeamSparringSchedule({
      roster: { teamA, teamB },
      courtsAvailable: 3,
      roundCount: 2,
      schedulingSeed: 1,
    });
    for (const r of rounds) {
      expect(r.courtsUsed).toBe(2);
    }
  });

  it("never double-books a player or a court within a round", () => {
    const teamA = makeSide("a", 6);
    const teamB = makeSide("b", 6);
    const stats = new Map<string, PlayerFairnessState>(
      [...teamA, ...teamB].map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
    );
    const roster: TeamRoster = { teamA, teamB };
    const result = generateTeamSparringRound({
      roster,
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
    expect(result.courtsUsed).toBe(3);
    expect(result.restingIds.length).toBe(0); // 6v6/3 courts uses everyone
  });

  it("returns zero rounds when one side has fewer than 2 players", () => {
    const rounds = generateTeamSparringSchedule({
      roster: { teamA: ["only1"], teamB: ["p1", "p2", "p3"] },
      courtsAvailable: 2,
      roundCount: 5,
      schedulingSeed: 1,
    });
    expect(rounds.length).toBe(0);
  });

  it("is deterministic for the same seed", () => {
    const teamA = makeSide("a", 5);
    const teamB = makeSide("b", 5);
    const input = { roster: { teamA, teamB }, courtsAvailable: 2, roundCount: 4, schedulingSeed: 123 };
    const r1 = generateTeamSparringSchedule(input);
    const r2 = generateTeamSparringSchedule(input);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
