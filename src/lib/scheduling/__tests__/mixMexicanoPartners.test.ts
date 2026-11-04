import { describe, it, expect } from "vitest";
import { mulberry32, PlayerFairnessState, recordRoundInHistory, emptyHistory, RoundResult } from "../types";
import { generateMixMexicanoRound, arrangeMixCourts } from "../mixMexicano";

/**
 * Partner variety in Mix Mexicano (Nov 2026): the same repeat-partner rule
 * plain Mexicano got in Oct (squared repeat cost + 4th/5th court swaps), with
 * gender mixing still first.
 *
 * Measured over 60 simulated nights each, before → after:
 *   4M4F, 2 courts, 8 rounds: worst pair 7 → 4 times; unmixed teams/night 4.0 → 0.1
 *   5M5F, 2 courts, 8 rounds: worst 4 → 3; pairs partnered 3+ times/night 1.5 → 0.8
 *   6M6F, 3 courts, 7 rounds: worst 4 → 3; unmixed teams/night 5.8 → 0.3
 *   8M8F, 4 courts, 7 rounds: worst 5 → 3; unmixed teams/night 9.7 → 1.2
 * (4M4F has only 16 mixed pairs for 32 partnerships a night, so some 3rds and
 * 4ths are unavoidable once every team is mixed.)
 */

function night(nM: number, nF: number, courts: number, rounds: number, seed: number) {
  const players = [...Array.from({ length: nM }, (_, i) => `M${i}`), ...Array.from({ length: nF }, (_, i) => `F${i}`)];
  const gender = new Map(players.map((p) => [p, p[0] as "M" | "F"]));
  const stats = new Map<string, PlayerFairnessState>(players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]));
  const rng = mulberry32(seed);
  const skill = new Map(players.map((p) => [p, rng() * 10]));
  const points = new Map(players.map((p) => [p, 0]));
  const history = emptyHistory();
  const out: RoundResult[] = [];
  let nonMixed = 0;
  for (let r = 0; r < rounds; r++) {
    const res = generateMixMexicanoRound({
      activePlayerIds: players, genderById: gender, statsById: stats, courtsAvailable: courts,
      standings: { rankValue: (id) => points.get(id)! }, isFirstRound: r === 0, history, rng,
    });
    out.push(res);
    recordRoundInHistory(history, res);
    for (const m of res.matches) {
      for (const t of [m.teamA, m.teamB]) if (gender.get(t[0]) === gender.get(t[1])) nonMixed++;
      const aWins = skill.get(m.teamA[0])! + skill.get(m.teamA[1])! + rng() * 6 > skill.get(m.teamB[0])! + skill.get(m.teamB[1])! + rng() * 6;
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
  return { history, nonMixed, out, players };
}

describe("Mix Mexicano partner variety", () => {
  for (const [m, f, c, r, worst] of [[4, 4, 2, 8, 4], [5, 5, 2, 8, 3], [6, 6, 3, 7, 3], [8, 8, 4, 7, 3]] as const) {
    it(`${m}M${f}F, ${c} courts, ${r} rounds: nobody partners the same person more than ${worst} times (60 nights)`, () => {
      for (let s = 1; s <= 60; s++) {
        expect(Math.max(...night(m, f, c, r, s * 7919).history.partnerCounts.values())).toBeLessThanOrEqual(worst);
      }
    });
  }

  it("mixing stays first: balanced rosters average under 1.5 unmixed teams a night", () => {
    for (const [m, f, c, r] of [[4, 4, 2, 8], [6, 6, 3, 7], [8, 8, 4, 7]] as const) {
      let total = 0;
      for (let s = 1; s <= 60; s++) total += night(m, f, c, r, s * 7919).nonMixed;
      expect(total / 60).toBeLessThan(1.5);
    }
  });

  it("every round seats each player once and fills every court; same night draws the same way", () => {
    const a = night(6, 6, 3, 7, 42);
    for (const res of a.out) {
      const seated = res.matches.flatMap((x) => [...x.teamA, ...x.teamB]);
      expect(new Set(seated).size).toBe(seated.length);
      expect(res.matches.length).toBe(3);
    }
    expect(night(6, 6, 3, 7, 42).out.map((x) => JSON.stringify(x.matches))).toEqual(a.out.map((x) => JSON.stringify(x.matches)));
  });

  it("arrangeMixCourts leaves the order alone with no history", () => {
    const g = new Map([["A", "M"], ["B", "F"], ["C", "M"], ["D", "F"], ["E", "M"], ["F", "F"], ["G", "M"], ["H", "F"]] as const);
    const ranked = ["A", "B", "C", "D", "E", "F", "G", "H"];
    expect(arrangeMixCourts(ranked, new Map(g))).toEqual(ranked);
    expect(arrangeMixCourts(ranked, new Map(g), emptyHistory())).toEqual(ranked);
  });
});
