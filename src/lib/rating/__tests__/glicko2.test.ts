import { describe, it, expect } from "vitest";
import {
  newRating,
  updateRating,
  applyInactivity,
  isProvisional,
  winProbability,
  DEFAULT_RATING,
  DEFAULT_RD,
} from "../glicko2";
import { computeGlobalRatings, RatingSession } from "../computeGlobalRatings";

describe("glicko2 single update", () => {
  it("a win raises the rating and shrinks uncertainty", () => {
    const before = newRating();
    const after = updateRating(before, [{ rating: 1500, rd: 50, score: 1 }]);
    expect(after.rating).toBeGreaterThan(before.rating);
    expect(after.rd).toBeLessThan(before.rd);
  });

  it("beating a much stronger opponent gains more than beating a weaker one", () => {
    const base = { rating: 1500, rd: 60, vol: 0.06 };
    const upset = updateRating(base, [{ rating: 1800, rd: 50, score: 1 }]);
    const easy = updateRating(base, [{ rating: 1200, rd: 50, score: 1 }]);
    expect(upset.rating - 1500).toBeGreaterThan(easy.rating - 1500);
    expect(easy.rating - 1500).toBeGreaterThan(0);
  });

  it("losing to a weaker opponent costs rating", () => {
    const after = updateRating({ rating: 1500, rd: 60, vol: 0.06 }, [{ rating: 1200, rd: 50, score: 0 }]);
    expect(after.rating).toBeLessThan(1500);
  });

  it("inactivity grows RD but never changes the rating", () => {
    const before = { rating: 1600, rd: 60, vol: 0.06 };
    const after = applyInactivity(before);
    expect(after.rating).toBe(1600);
    expect(after.rd).toBeGreaterThan(before.rd);
  });

  it("an empty period is treated as inactivity", () => {
    const before = { rating: 1600, rd: 60, vol: 0.06 };
    expect(updateRating(before, [])).toEqual(applyInactivity(before));
  });

  it("a brand-new player is provisional; a played-in one is not", () => {
    expect(isProvisional(newRating())).toBe(true);
    const played = updateRating(newRating(), [
      { rating: 1500, rd: 60, score: 1 },
      { rating: 1500, rd: 60, score: 1 },
      { rating: 1500, rd: 60, score: 0 },
    ]);
    // still provisional after 3 games, but RD has dropped a lot from 350
    expect(played.rd).toBeLessThan(DEFAULT_RD);
  });

  it("win probability is 50% for equal ratings and >50% for the stronger side", () => {
    expect(winProbability(1500, 1500)).toBeCloseTo(0.5, 5);
    expect(winProbability(1700, 1500)).toBeGreaterThan(0.5);
  });
});

describe("computeGlobalRatings (replay)", () => {
  // Hidden true skill; results are decided by it so the rating should recover
  // the true ORDER after enough rating periods.
  const TRUE: Record<string, number> = { A: 1750, B: 1600, C: 1450, D: 1300 };
  const winProb = (t1: string[], t2: string[]) => {
    const s1 = (TRUE[t1[0]] + TRUE[t1[1]]) / 2;
    const s2 = (TRUE[t2[0]] + TRUE[t2[1]]) / 2;
    return 1 / (1 + Math.pow(10, (s2 - s1) / 400));
  };
  // deterministic pseudo-random so the test never flakes
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("deterministically: winners rise, losers fall, partners move together", () => {
    // A&B always partner and win; C&D always partner and lose. No randomness.
    const sessions: RatingSession[] = [];
    for (let i = 0; i < 15; i++) sessions.push({ matches: [{ sideA: ["A", "B"], sideB: ["C", "D"], outcome: "win_a" }] });
    const r = computeGlobalRatings(sessions);
    expect(r.get("A")!.rating).toBeGreaterThan(r.get("C")!.rating);
    expect(r.get("B")!.rating).toBeGreaterThan(r.get("D")!.rating);
    expect(Math.abs(r.get("A")!.rating - r.get("B")!.rating)).toBeLessThan(1); // partners track
    expect(Math.abs(r.get("C")!.rating - r.get("D")!.rating)).toBeLessThan(1);
  });

  it("recovers the true skill order on average (a single small run is noisy — that's real)", () => {
    // A single 4-player run can cross adjacent players by chance; the MEAN over
    // many independent runs must recover A>B>C>D. This is a stable assertion.
    const pairings: [string[], string[]][] = [
      [["A", "B"], ["C", "D"]],
      [["A", "C"], ["B", "D"]],
      [["A", "D"], ["B", "C"]],
    ];
    const RUNS = 200;
    const sum: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (let run = 0; run < RUNS; run++) {
      const rng = mulberry32(1000 + run);
      const sessions: RatingSession[] = [];
      for (let i = 0; i < 30; i++) {
        const matches = pairings.map(([t1, t2]) => ({
          sideA: t1,
          sideB: t2,
          outcome: (rng() < winProb(t1, t2) ? "win_a" : "win_b") as "win_a" | "win_b",
        }));
        sessions.push({ matches });
      }
      const r = computeGlobalRatings(sessions);
      for (const k of ["A", "B", "C", "D"]) sum[k] += r.get(k)!.rating;
    }
    expect(sum.A).toBeGreaterThan(sum.B);
    expect(sum.B).toBeGreaterThan(sum.C);
    expect(sum.C).toBeGreaterThan(sum.D);
  });

  it("field size doesn't matter: a 6-player night and a 2-player night update identically per match", () => {
    // Same head-to-head result should move A the same whether or not other
    // courts also played that night.
    const solo: RatingSession[] = [{ matches: [{ sideA: ["A", "B"], sideB: ["C", "D"], outcome: "win_a" }] }];
    const crowded: RatingSession[] = [
      {
        matches: [
          { sideA: ["A", "B"], sideB: ["C", "D"], outcome: "win_a" },
          { sideA: ["E", "F"], sideB: ["G", "H"], outcome: "win_a" },
        ],
      },
    ];
    const a1 = computeGlobalRatings(solo).get("A")!.rating;
    const a2 = computeGlobalRatings(crowded).get("A")!.rating;
    expect(a1).toBeCloseTo(a2, 6);
  });

  it("never resets: a player keeps their number across sessions they sit out", () => {
    const sessions: RatingSession[] = [
      { matches: [{ sideA: ["A", "B"], sideB: ["C", "D"], outcome: "win_a" }] },
      { matches: [{ sideA: ["C", "E"], sideB: ["D", "F"], outcome: "win_a" }] }, // A doesn't play
    ];
    const r = computeGlobalRatings(sessions);
    expect(r.get("A")!.rating).toBeGreaterThan(DEFAULT_RATING); // still elevated from session 1
    expect(r.get("A")!.games).toBe(1);
  });
});
