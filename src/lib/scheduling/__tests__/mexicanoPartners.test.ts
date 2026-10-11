import { describe, it, expect } from "vitest";
import { mulberry32, PlayerFairnessState, recordRoundInHistory, emptyHistory, pairKey } from "../types";
import { generateMexicanoRound, arrangeCourts } from "../mexicano";
import { bestCourtSplit } from "../courtSplit";

/**
 * Partner variety in Mexicano (Oct 2026). Hamud: "when playing mexicano I
 * don't want to be partnered with the same 2–3 people unless there is no
 * other option."
 *
 * Measured before the change, over 60 simulated nights each: 10 players on 2
 * courts for 8 rounds left 0.23 pairs per night partnered three times or
 * more; 12 on 3 courts, 0.45; worst case a pair partnered 4 times. After: 0.
 */

function night(n: number, courts: number, rounds: number, seed: number) {
  const players = Array.from({ length: n }, (_, i) => `P${String(i + 1).padStart(2, "0")}`);
  const stats = new Map<string, PlayerFairnessState>(players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]));
  const skill = new Map(players.map((p, i) => [p, n - i]));
  const points = new Map(players.map((p) => [p, 0]));
  const rng = mulberry32(seed);
  const history = emptyHistory();
  const roundsOut = [];
  for (let r = 0; r < rounds; r++) {
    const res = generateMexicanoRound({
      activePlayerIds: players, statsById: stats, courtsAvailable: courts,
      standings: { rankValue: (id) => points.get(id)! }, isFirstRound: r === 0, history, rng,
    });
    roundsOut.push(res);
    recordRoundInHistory(history, res);
    for (const m of res.matches) {
      const aWins = skill.get(m.teamA[0])! + skill.get(m.teamA[1])! + rng() * 8 > skill.get(m.teamB[0])! + skill.get(m.teamB[1])! + rng() * 8;
      const win = 21 - Math.floor(rng() * 9);
      for (const p of m.teamA) points.set(p, points.get(p)! + (aWins ? win : 21 - win));
      for (const p of m.teamB) points.set(p, points.get(p)! + (aWins ? 21 - win : win));
    }
    const on = new Set(res.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    for (const id of players) {
      const s = stats.get(id)!;
      stats.set(id, { playerId: id, matchesPlayed: s.matchesPlayed + (on.has(id) ? 1 : 0), restedLastRound: !on.has(id) });
    }
  }
  return { history, roundsOut, players };
}

describe("Mexicano partner variety", () => {
  for (const [n, c, r] of [[10, 2, 8], [12, 2, 8], [12, 3, 7], [16, 4, 7]] as const) {
    it(`${n} players, ${c} courts, ${r} rounds: nobody partners the same person 3 times (40 nights)`, () => {
      for (let s = 1; s <= 40; s++) {
        const { history } = night(n, c, r, s * 7919);
        expect(Math.max(...history.partnerCounts.values())).toBeLessThanOrEqual(2);
      }
    });
  }

  it("every round still seats each player once, and fills every court", () => {
    for (let s = 1; s <= 20; s++) {
      const { roundsOut } = night(12, 3, 7, s);
      for (const res of roundsOut) {
        const seated = res.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
        expect(new Set(seated).size).toBe(seated.length);
        expect(res.matches.length).toBe(3);
      }
    }
  });

  it("the same night draws the same way twice (deterministic)", () => {
    const a = night(10, 2, 8, 42).roundsOut.map((r) => JSON.stringify(r.matches));
    const b = night(10, 2, 8, 42).roundsOut.map((r) => JSON.stringify(r.matches));
    expect(a).toEqual(b);
  });
});

describe("arrangeCourts", () => {
  const ranked = ["A", "B", "C", "D", "E", "F", "G", "H"];

  it("leaves the standings order alone with no history", () => {
    expect(arrangeCourts(ranked)).toEqual(ranked);
    expect(arrangeCourts(ranked, emptyHistory())).toEqual(ranked);
  });

  it("swaps 4th and 5th — never anyone further apart — to spare a repeat partner", () => {
    const h = emptyHistory();
    // The top four have already partnered every way they can.
    for (const [x, y] of [["A", "D"], ["B", "C"], ["A", "C"], ["B", "D"], ["A", "B"], ["C", "D"]]) {
      h.partnerCounts.set(pairKey(x, y), 1);
      h.partnerPairsSeen.add(pairKey(x, y));
    }
    const out = arrangeCourts(ranked, h);
    expect(out).toEqual(["A", "B", "C", "E", "D", "F", "G", "H"]);
  });

  it("a pair who have never partnered beats any repeat, even at the cost of balance", () => {
    const h = emptyHistory();
    h.partnerCounts.set(pairKey("A", "D"), 2);
    h.partnerCounts.set(pairKey("B", "C"), 0);
    h.partnerCounts.set(pairKey("A", "C"), 1);
    h.partnerCounts.set(pairKey("B", "D"), 1);
    // A+D again would be their 3rd; A+C / B+D are each a 2nd.
    const s = bestCourtSplit(["A", "B", "C", "D"], h);
    expect(s.teamA).toEqual(["A", "B"]);
  });
});
