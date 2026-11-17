import { describe, it, expect } from "vitest";
import { generateAmericanoSchedule, AMERICANO_RULES } from "../americano";
import { generateMixAmericanoSchedule, mixRules } from "../mixAmericano";
import { generateTeamSparringSchedule, teamSparringRules } from "../teamSparring";
import { generateFixedPartnerSchedule, makePair, Pair } from "../fixedPartner";
import { circlePairs, priorFromRounds, scheduleGaps } from "../balance";
import { PlayerId, RoundResult, pairKey } from "../types";

/**
 * The "repeat while unplayed" mistake, across every pre-drawn format (Nov 2026).
 *
 * Hamud's Fixed Partner night had one pair meet another three times while two
 * pairs never met. The same thing, measured per player, happened in Americano,
 * Mix Americano, Fixed Position and Team Sparring: someone partnered one person
 * three times and never partnered someone they could have. The promise now:
 * nobody gets the same partner again while there's someone they could have
 * partnered and haven't — a partner "gap" of at most 1 — and that holds across
 * redraws and added rounds, not just within one draw.
 */

const ids = (n: number, pre = "p") => Array.from({ length: n }, (_, i) => `${pre}${i}`);

function gamesSpread(rounds: RoundResult[], players: PlayerId[], groups?: PlayerId[][]): number {
  const games = new Map<PlayerId, number>(players.map((p) => [p, 0]));
  let worst = 0;
  for (const r of rounds) {
    for (const m of r.matches) for (const id of [...m.teamA, ...m.teamB]) games.set(id, (games.get(id) ?? 0) + 1);
    for (const g of groups ?? [players]) {
      const v = g.map((p) => games.get(p) ?? 0);
      worst = Math.max(worst, Math.max(...v) - Math.min(...v));
    }
  }
  return worst;
}

describe("partners never repeat while someone is unpartnered", () => {
  const seeds = [11, 222, 3333];

  it.each([
    [8, 2, 7],
    [12, 3, 11],
    [16, 3, 10],
    [16, 4, 15], // was a gap of 2 before the circle-method start
    [10, 2, 9],
    [13, 3, 12],
    [6, 1, 8],
  ])("Americano %ip on %i courts, %i rounds", (n, courts, rounds) => {
    for (const s of seeds) {
      const pl = ids(n);
      const r = generateAmericanoSchedule({ activePlayerIds: pl, courtsAvailable: courts, roundCount: rounds, schedulingSeed: s });
      expect(r.length).toBe(rounds);
      expect(scheduleGaps(r, pl, AMERICANO_RULES).partnerGap).toBeLessThanOrEqual(1);
      expect(gamesSpread(r, pl)).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    [4, 4, 2, 4],
    [6, 6, 3, 6],
    [8, 8, 3, 10],
    [6, 6, 2, 9],
    [5, 7, 3, 8],
  ])("Mix Americano %iM + %iF on %i courts, %i rounds", (nm, nf, courts, rounds) => {
    for (const s of seeds) {
      const pl = [...ids(nm, "m"), ...ids(nf, "f")];
      const g = new Map(pl.map((p) => [p, (p[0] === "m" ? "M" : "F") as "M" | "F"]));
      const r = generateMixAmericanoSchedule({ activePlayerIds: pl, genderById: g, courtsAvailable: courts, roundCount: rounds, schedulingSeed: s });
      expect(scheduleGaps(r, pl, mixRules(g)).partnerGap).toBeLessThanOrEqual(1);
      expect(gamesSpread(r, pl)).toBeLessThanOrEqual(1);
      if (nm === nf) {
        // Equal numbers: every team is one man and one woman, always.
        for (const rr of r) for (const m of rr.matches) for (const t of [m.teamA, m.teamB]) expect(g.get(t[0])).not.toBe(g.get(t[1]));
      }
    }
  });

  it.each([
    [4, 4, 2, 6],
    [6, 6, 3, 8],
    [8, 8, 3, 10],
    [7, 9, 3, 9],
  ])("Team Sparring %iv%i on %i courts, %i rounds", (na, nb, courts, rounds) => {
    for (const s of seeds) {
      const A = ids(na, "a");
      const B = ids(nb, "b");
      const roster = { teamA: A, teamB: B };
      const r = generateTeamSparringSchedule({ roster, courtsAvailable: courts, roundCount: rounds, schedulingSeed: s });
      const gaps = scheduleGaps(r, [...A, ...B], teamSparringRules(roster));
      expect(gaps.partnerGap).toBeLessThanOrEqual(1);
      expect(gaps.opponentGap).toBeLessThanOrEqual(2);
      expect(gamesSpread(r, [...A, ...B], [A, B])).toBeLessThanOrEqual(1);
      // Partners always from your own team, opponents always from the other.
      for (const rr of r) for (const m of rr.matches) {
        expect(A.includes(m.teamA[0])).toBe(A.includes(m.teamA[1]));
        expect(A.includes(m.teamA[0])).not.toBe(A.includes(m.teamB[0]));
      }
    }
  });
});

describe("the circle method", () => {
  it("partners everyone with everyone exactly once every n - 1 rounds", () => {
    const pl = ids(12);
    const seen = new Map<string, number>();
    for (let r = 0; r < 11; r++) {
      const pairs = circlePairs(pl, r);
      expect(new Set(pairs.flat()).size).toBe(12);
      for (const [a, b] of pairs) seen.set(pairKey(a, b), (seen.get(pairKey(a, b)) ?? 0) + 1);
    }
    expect(seen.size).toBe(66);
    expect([...seen.values()].every((c) => c === 1)).toBe(true);
  });
});

describe("redraws and added rounds carry on the night", () => {
  it("Americano: three rounds played, the rest redrawn — still no gap of 2 over the whole night", () => {
    for (const s of [5, 50, 500]) {
      const pl = ids(12);
      const night = generateAmericanoSchedule({ activePlayerIds: pl, courtsAvailable: 3, roundCount: 11, schedulingSeed: s });
      const played = night.slice(0, 3);
      const rest = generateAmericanoSchedule({ activePlayerIds: pl, courtsAvailable: 3, roundCount: 8, schedulingSeed: s + 1, prior: priorFromRounds(played) });
      const whole = [...played, ...rest];
      expect(scheduleGaps(whole, pl, AMERICANO_RULES).partnerGap).toBeLessThanOrEqual(1);
      expect(gamesSpread(whole, pl)).toBeLessThanOrEqual(1);
    }
  });

  it("Americano: rounds added in a batch continue the balance", () => {
    for (const s of [7, 70, 700]) {
      const pl = ids(10);
      const first = generateAmericanoSchedule({ activePlayerIds: pl, courtsAvailable: 2, roundCount: 5, schedulingSeed: s });
      const more = generateAmericanoSchedule({ activePlayerIds: pl, courtsAvailable: 2, roundCount: 5, schedulingSeed: s + 9, prior: priorFromRounds(first) });
      const whole = [...first, ...more];
      expect(scheduleGaps(whole, pl, AMERICANO_RULES).partnerGap).toBeLessThanOrEqual(1);
      expect(gamesSpread(whole, pl)).toBeLessThanOrEqual(1);
    }
  });

  it("a latecomer is caught up: they play every round until level", () => {
    const pl = ids(9);
    const early = pl.slice(0, 8);
    const first = generateAmericanoSchedule({ activePlayerIds: early, courtsAvailable: 2, roundCount: 2, schedulingSeed: 3 });
    const more = generateAmericanoSchedule({ activePlayerIds: pl, courtsAvailable: 2, roundCount: 4, schedulingSeed: 4, prior: priorFromRounds(first) });
    const late = pl[8];
    expect(more.every((r) => r.matches.some((m) => [...m.teamA, ...m.teamB].includes(late)))).toBe(true);
  });

  it("Mix Americano: rounds added after the first ones keep teams mixed and partners even", () => {
    const pl = [...ids(6, "m"), ...ids(6, "f")];
    const g = new Map(pl.map((p) => [p, (p[0] === "m" ? "M" : "F") as "M" | "F"]));
    const first = generateMixAmericanoSchedule({ activePlayerIds: pl, genderById: g, courtsAvailable: 3, roundCount: 3, schedulingSeed: 8 });
    const more = generateMixAmericanoSchedule({ activePlayerIds: pl, genderById: g, courtsAvailable: 3, roundCount: 3, schedulingSeed: 9, prior: priorFromRounds(first) });
    const whole = [...first, ...more];
    // 6 rounds of 6 men and 6 women: every man partners every woman exactly once.
    expect(scheduleGaps(whole, pl, mixRules(g)).partnerGap).toBe(0);
  });

  it("Fixed Partner: added rounds meet the pairs not met yet first", () => {
    const pairs: Pair[] = Array.from({ length: 8 }, (_, i) => makePair(`x${i}`, `y${i}`));
    for (const s of [1, 2, 3]) {
      const first = generateFixedPartnerSchedule({ pairs, courtsAvailable: 3, roundCount: 4, schedulingSeed: s });
      const more = generateFixedPartnerSchedule({ pairs, courtsAvailable: 3, roundCount: 6, schedulingSeed: s + 10, prior: priorFromRounds(first) });
      const pairOf = new Map(pairs.flatMap((p) => [[p.playerA, p.pairId], [p.playerB, p.pairId]] as [string, string][]));
      const met = new Map<string, number>();
      let repeatsBeforeAllMet = 0;
      for (const r of [...first, ...more]) {
        for (const m of r.matches) {
          const k = pairKey(pairOf.get(m.teamA[0])!, pairOf.get(m.teamB[0])!);
          if ((met.get(k) ?? 0) > 0 && met.size < 28) repeatsBeforeAllMet++;
          met.set(k, (met.get(k) ?? 0) + 1);
        }
      }
      // 10 rounds × 3 courts = 30 games ≥ 28 matchups: everyone meets everyone.
      expect(met.size).toBe(28);
      expect(repeatsBeforeAllMet).toBe(0);
    }
  });
});
