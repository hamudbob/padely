import { describe, it, expect } from "vitest";
import { generateAmericanoSchedule } from "../americano";

/**
 * Rest fairness has to hold DURING the night, not just at the end of it.
 *
 * A real session, 8 Sep 2026: six players, one court, eight pre-generated
 * rounds. The totals came out fine — five or six games each — but player C sat
 * out rounds 1, 2 and 3 and then played five in a row:
 *
 *     A: PP.P..PP        C: ...PPPPP
 *     B: PPP.PP.P        D: PPP.P.PP
 *
 * The host's complaint was exact: "in a court of 6 players there will be 1 game
 * rest after 2 times playing". Three rounds on the bench while everyone else
 * plays is not a schedule, it is a punishment, and the person it happens to has
 * paid for the court like everybody else.
 *
 * WHY IT HAPPENED. The schedule is built greedily by selectPlayersForRound,
 * which guarantees a spread of at most one game — that part was always right.
 * Then optimizeAmericano runs simulated annealing over the finished schedule,
 * and its objective summed each player's TOTAL games:
 *
 *     for (const v of play.values()) f += v * v * 60;
 *
 * A total has no notion of WHEN. Moving every one of C's games to the end of
 * the night leaves that number completely unchanged, so the search was free to
 * do it — and did, because partner variety is weighted 1000 and buying one
 * fresh partnership at the cost of C's evening was, to the objective, free.
 *
 * The objective measured the destination and ignored the journey.
 *
 * THE INVARIANT. After every round, the most-played and least-played player may
 * differ by at most one game. That is exactly "everybody rests once before
 * anybody rests twice", it is what the greedy pass already produced, and it is
 * achievable for any player/court count where a court can be filled at all.
 */

const ids = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

/** Cumulative games per player after each round, in order. */
function runningPlayCounts(rounds: ReturnType<typeof generateAmericanoSchedule>, players: string[]) {
  const total = new Map(players.map((p) => [p, 0]));
  return rounds.map((r) => {
    for (const m of r.matches) for (const p of [...m.teamA, ...m.teamB]) total.set(p, total.get(p)! + 1);
    return new Map(total);
  });
}

function worstSpread(rounds: ReturnType<typeof generateAmericanoSchedule>, players: string[]) {
  let worst = 0;
  let atRound = 0;
  runningPlayCounts(rounds, players).forEach((counts, i) => {
    const v = [...counts.values()];
    const spread = Math.max(...v) - Math.min(...v);
    if (spread > worst) {
      worst = spread;
      atRound = i + 1;
    }
  });
  return { worst, atRound };
}

/** Longest run of consecutive rounds any player spends on the bench. */
function longestBenchStreak(rounds: ReturnType<typeof generateAmericanoSchedule>, players: string[]) {
  let longest = 0;
  for (const p of players) {
    let run = 0;
    for (const r of rounds) {
      const on = r.matches.some((m) => [...m.teamA, ...m.teamB].includes(p));
      run = on ? 0 : run + 1;
      if (run > longest) longest = run;
    }
  }
  return longest;
}

describe("Americano rest fairness holds throughout the session", () => {
  // The exact shape that failed in production, plus the neighbours either side.
  const cases: { players: number; courts: number; rounds: number }[] = [
    { players: 5, courts: 1, rounds: 8 },
    { players: 6, courts: 1, rounds: 8 },
    { players: 6, courts: 1, rounds: 12 },
    { players: 7, courts: 1, rounds: 10 },
    { players: 9, courts: 2, rounds: 10 },
    { players: 10, courts: 2, rounds: 12 },
    { players: 13, courts: 3, rounds: 12 },
  ];

  for (const c of cases) {
    it(`${c.players} players, ${c.courts} court(s), ${c.rounds} rounds — spread never exceeds 1`, () => {
      const players = ids(c.players);
      // Several seeds: this is a randomised search, and a fairness guarantee
      // that only holds for a lucky seed is not a guarantee.
      for (let seed = 1; seed <= 6; seed++) {
        const rounds = generateAmericanoSchedule({
          activePlayerIds: players,
          courtsAvailable: c.courts,
          roundCount: c.rounds,
          schedulingSeed: seed * 1013,
        });
        expect(rounds.length).toBeGreaterThan(0);
        const { worst, atRound } = worstSpread(rounds, players);
        expect(
          worst,
          `seed ${seed}: after round ${atRound} the most- and least-played differed by ${worst} games`,
        ).toBeLessThanOrEqual(1);
      }
    });
  }

  it("nobody sits out three rounds in a row when a court could have held them", () => {
    // Six players, one court: two rest each round, so a fair rotation gives
    // everyone play-play-rest. Two consecutive rests can be legitimate; three
    // is the production bug.
    const players = ids(6);
    for (let seed = 1; seed <= 6; seed++) {
      const rounds = generateAmericanoSchedule({
        activePlayerIds: players,
        courtsAvailable: 1,
        roundCount: 8,
        schedulingSeed: seed * 7717,
      });
      expect(longestBenchStreak(rounds, players), `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it("still finishes with totals as even as the arithmetic allows", () => {
    // The old objective got this right and the fix must not lose it: 8 rounds
    // x 4 slots = 32 games over 6 players, so two players get 6 and four get 5.
    const players = ids(6);
    const rounds = generateAmericanoSchedule({
      activePlayerIds: players,
      courtsAvailable: 1,
      roundCount: 8,
      schedulingSeed: 4242,
    });
    const total = new Map(players.map((p) => [p, 0]));
    for (const r of rounds) for (const m of r.matches) for (const p of [...m.teamA, ...m.teamB]) total.set(p, total.get(p)! + 1);
    const v = [...total.values()].sort((a, b) => a - b);
    expect(v.reduce((s, x) => s + x, 0)).toBe(32);
    expect(v[v.length - 1] - v[0]).toBeLessThanOrEqual(1);
  });

  it("partner variety is still spread, not sacrificed to fix rests", () => {
    // The fix must not simply freeze the greedy schedule. With 8 players on 2
    // courts nobody rests at all, so rest fairness is trivially satisfied and
    // this measures only what the annealer is for.
    const players = ids(8);
    const rounds = generateAmericanoSchedule({
      activePlayerIds: players,
      courtsAvailable: 2,
      roundCount: 7,
      schedulingSeed: 31337,
    });
    const partnerCounts = new Map<string, number>();
    for (const r of rounds) {
      for (const m of r.matches) {
        for (const t of [m.teamA, m.teamB]) {
          const k = [...t].sort().join("|");
          partnerCounts.set(k, (partnerCounts.get(k) ?? 0) + 1);
        }
      }
    }
    // 7 rounds x 4 teams = 28 partnerships from 28 possible pairs among 8
    // players. A perfect schedule uses each once; allow a little slack, but a
    // pair repeated 3+ times means the search has stopped working.
    expect(Math.max(...partnerCounts.values())).toBeLessThanOrEqual(2);
  });
});
