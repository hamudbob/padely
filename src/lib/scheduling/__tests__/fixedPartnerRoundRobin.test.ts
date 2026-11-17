import { describe, it, expect } from "vitest";
import {
  Pair,
  PairFairnessState,
  buildPairByPlayerId,
  emptyPairHistory,
  generateFixedPartnerRound,
  generateFixedPartnerSchedule,
  makePair,
  recordPairMatchup,
} from "../fixedPartner";
import { mulberry32, pairKey } from "../types";

/**
 * The round-robin flavor of Fixed Partner (Nov 2026 fix). A user's night —
 * 8 pairs, 3 courts, 10 rounds drawn at the start — came out with three
 * repeated matchups while two pairs never met, and the 11th round gave two
 * pairs a 9th game while others rested on 8.
 */

function makePairs(n: number): Pair[] {
  return Array.from({ length: n }, (_, i) => makePair(`p${i}a`, `p${i}b`));
}

function analyse(pairs: Pair[], rounds: ReturnType<typeof generateFixedPartnerSchedule>) {
  const byPlayer = buildPairByPlayerId(pairs);
  const meet = new Map<string, number>();
  const games = new Map<string, number>(pairs.map((p) => [p.pairId, 0]));
  let restedTwiceRunning = 0;
  let prevResting = new Set<string>();
  let repeatsBeforeFullCircle = 0;
  const total = (pairs.length * (pairs.length - 1)) / 2;
  for (const r of rounds) {
    const playing = new Set<string>();
    for (const m of r.matches) {
      const a = byPlayer.get(m.teamA[0])!;
      const b = byPlayer.get(m.teamB[0])!;
      const k = pairKey(a, b);
      if ((meet.get(k) ?? 0) > 0 && meet.size < total) repeatsBeforeFullCircle++;
      meet.set(k, (meet.get(k) ?? 0) + 1);
      games.set(a, games.get(a)! + 1);
      games.set(b, games.get(b)! + 1);
      playing.add(a);
      playing.add(b);
    }
    const resting = new Set(pairs.filter((p) => !playing.has(p.pairId)).map((p) => p.pairId));
    for (const id of resting) if (prevResting.has(id)) restedTwiceRunning++;
    prevResting = resting;
  }
  const g = [...games.values()];
  return { distinct: meet.size, total, repeatsBeforeFullCircle, spread: Math.max(...g) - Math.min(...g), restedTwiceRunning };
}

describe("Fixed Partner round robin", () => {
  it("8 pairs, 3 courts, 10 rounds: everyone meets everyone, games within one", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const pairs = makePairs(8);
      const rounds = generateFixedPartnerSchedule({ pairs, courtsAvailable: 3, roundCount: 10, schedulingSeed: seed * 977 });
      const a = analyse(pairs, rounds);
      expect(rounds).toHaveLength(10);
      expect(a.distinct).toBe(28);
      expect(a.repeatsBeforeFullCircle).toBe(0);
      expect(a.spread).toBeLessThanOrEqual(1);
      expect(a.restedTwiceRunning).toBe(0);
    }
  });

  it("other sizes never repeat a matchup before every pair has met", () => {
    for (const [n, courts, roundCount] of [
      [4, 1, 6],
      [5, 2, 10],
      [6, 2, 8],
      [7, 3, 7],
      [8, 4, 7],
      [9, 4, 9],
      [10, 3, 15],
      [12, 4, 11],
      [16, 6, 12],
    ] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const pairs = makePairs(n);
        const rounds = generateFixedPartnerSchedule({ pairs, courtsAvailable: courts, roundCount, schedulingSeed: seed * 31 + n });
        const a = analyse(pairs, rounds);
        expect(a.repeatsBeforeFullCircle, `${n} pairs, ${courts} courts, seed ${seed}`).toBe(0);
        expect(a.spread, `${n} pairs, ${courts} courts`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the user's night: round 11 rests pairs on 8 games and plays the one unplayed matchup", () => {
    const names = ["AN", "AS", "RS", "AF", "KM", "KS", "AP", "FS"];
    const pairs = names.map((x) => makePair(`${x}1`, `${x}2`));
    const id = (x: string) => pairs[names.indexOf(x)].pairId;
    const played: [string, string][] = [
      ["AN", "AS"], ["RS", "AF"], ["KM", "KS"], ["AP", "KM"], ["AF", "FS"], ["RS", "AN"], ["FS", "AN"], ["AS", "AP"], ["RS", "KS"],
      ["KM", "AS"], ["KS", "FS"], ["AF", "AP"], ["FS", "RS"], ["KS", "AS"], ["AF", "AN"], ["RS", "AP"], ["AF", "KS"], ["KM", "FS"],
      ["AF", "KM"], ["AN", "AP"], ["RS", "AS"], ["KM", "AN"], ["FS", "AS"], ["AP", "KS"], ["RS", "AF"], ["FS", "AP"], ["AN", "KS"],
      ["AS", "AN"], ["FS", "KS"], ["KM", "RS"],
    ];
    const history = emptyPairHistory();
    const games = new Map<string, number>(names.map((x) => [id(x), 0]));
    for (const [a, b] of played) {
      recordPairMatchup(history, id(a), id(b));
      games.set(id(a), games.get(id(a))! + 1);
      games.set(id(b), games.get(id(b))! + 1);
    }
    const lastRound = new Set(["AS", "AN", "FS", "KS", "KM", "RS"].map(id));
    const statsById = new Map<string, PairFairnessState>(
      pairs.map((p) => [p.pairId, { pairId: p.pairId, matchesPlayed: games.get(p.pairId)!, restedLastRound: !lastRound.has(p.pairId) }]),
    );
    const r = generateFixedPartnerRound({ pairs, statsById, courtsAvailable: 3, history, rng: mulberry32(11) });
    const byPlayer = buildPairByPlayerId(pairs);
    const resting = pairs.filter((p) => r.restingIds.includes(p.playerA)).map((p) => p.pairId);
    // Only pairs already on 8 games rest; all four pairs on 7 play.
    for (const p of resting) expect(games.get(p)).toBe(8);
    for (const x of ["AS", "AF", "AP", "KM"]) expect(resting).not.toContain(id(x));
    // Adel & Sammy finally meet Aisha & Fuad.
    const keys = r.matches.map((m) => pairKey(byPlayer.get(m.teamA[0])!, byPlayer.get(m.teamB[0])!));
    expect(keys).toContain(pairKey(id("AS"), id("AF")));
  });
});
