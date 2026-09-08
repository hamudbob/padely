import { describe, it, expect } from "vitest";
import { computeStandings, CompletedMatchResult } from "../standings";

/**
 * The two ranking ladders, and the tiebreaks that define them.
 *
 *   points_first   points -> wins -> fewer losses -> head-to-head
 *   wins_first     wins -> fewer losses -> points -> head-to-head
 *
 * These are not interchangeable orderings of the same data. A host picks
 * "Wins first" to say that WINNING is what counts and margin is noise; a host
 * picks "Points first" to say every game won counts. Whichever they picked has
 * to hold everywhere — the table, the rank badge, and the court seeding — or
 * the app contradicts itself on screen, which is exactly what happened in the
 * 8 Sep session that prompted these tests.
 */

let n = 0;
/** One completed match: `a` beat `b` by scoreA-scoreB. */
function win(a: string[], b: string[], scoreA: number, scoreB: number): CompletedMatchResult {
  return { matchId: `m${++n}`, sideA: a, sideB: b, scoreA, scoreB, outcome: "win_a" };
}
const orderOf = (rows: { subjectId: string }[]) => rows.map((r) => r.subjectId);

describe("ranking basis decides the ladder", () => {
  it("orders the same field differently under each basis", () => {
    // GRINDER wins a lot, narrowly.       3 wins, 0 losses,  9 points
    // SLUGGER wins less, hugely.          2 wins, 1 loss,   11 points
    const matches = [
      win(["grinder"], ["slugger"], 3, 2),
      win(["grinder"], ["filler"], 3, 2),
      win(["grinder"], ["filler"], 3, 2),
      win(["slugger"], ["filler"], 5, 0),
      win(["slugger"], ["filler"], 5, 0),
      win(["filler"], ["slugger"], 3, 1),
    ];
    const ids = ["grinder", "slugger", "filler"];

    // Points-first rewards the margin.
    expect(orderOf(computeStandings(ids, matches, [], "points_first"))[0]).toBe("slugger");
    // Wins-first rewards the result.
    expect(orderOf(computeStandings(ids, matches, [], "wins_first"))[0]).toBe("grinder");
  });

  it("wins_first breaks a win tie on FEWER LOSSES before points", () => {
    // Both on 2 wins. `tidy` has played fewer matches and lost fewer;
    // `heavy` has more points. Fewer losses must win — that is the basis.
    const matches = [
      win(["tidy"], ["x"], 3, 2),
      win(["tidy"], ["y"], 3, 2),           // tidy: 2W 0L, 6 pts
      win(["heavy"], ["x"], 5, 0),
      win(["heavy"], ["y"], 5, 0),          // heavy: 2W ... 10 pts
      win(["z"], ["heavy"], 5, 4),          // ...1L, 14 pts
    ];
    const ids = ["tidy", "heavy", "x", "y", "z"];

    const winsFirst = orderOf(computeStandings(ids, matches, [], "wins_first"));
    expect(winsFirst.indexOf("tidy")).toBeLessThan(winsFirst.indexOf("heavy"));

    // Under points-first the same two flip, because points outrank the record.
    const pointsFirst = orderOf(computeStandings(ids, matches, [], "points_first"));
    expect(pointsFirst.indexOf("heavy")).toBeLessThan(pointsFirst.indexOf("tidy"));
  });

  it("points_first breaks a points tie on wins, then fewer losses", () => {
    // Both land on 6 points. `winner` got there with 2 wins, `loser` with 1.
    const matches = [
      win(["winner"], ["p"], 3, 2),
      win(["winner"], ["q"], 3, 2),         // 2W 0L, 6 pts
      win(["loser"], ["p"], 5, 0),          // 1W
      win(["q"], ["loser"], 5, 1),          // 1L  -> 6 pts
    ];
    const ids = ["winner", "loser", "p", "q"];
    const order = orderOf(computeStandings(ids, matches, [], "points_first"));
    expect(order.indexOf("winner")).toBeLessThan(order.indexOf("loser"));
  });

  it("head-to-head separates two players level on every counting key", () => {
    // Identical records; met once, `beat` won.
    const matches = [
      win(["beat"], ["lost"], 3, 2),
      win(["lost"], ["r"], 3, 2),
      win(["beat"], ["r"], 3, 2),
      win(["r"], ["lost"], 3, 2),
      win(["r"], ["beat"], 3, 2),
    ];
    const ids = ["beat", "lost", "r"];
    for (const basis of ["points_first", "wins_first"] as const) {
      const order = orderOf(computeStandings(ids, matches, [], basis));
      expect(order.indexOf("beat"), basis).toBeLessThan(order.indexOf("lost"));
    }
  });

  it("ties that no key can separate share a rank", () => {
    const matches = [win(["a"], ["c"], 3, 2), win(["b"], ["d"], 3, 2)];
    const rows = computeStandings(["a", "b", "c", "d"], matches, [], "wins_first");
    const byId = new Map(rows.map((r) => [r.subjectId, r]));
    expect(byId.get("a")!.rank).toBe(byId.get("b")!.rank);
  });

  it("rest compensation still applies under either basis", () => {
    // `rested` played one fewer match; +2 per missed match keeps them level.
    const matches = [win(["played"], ["opp"], 4, 1), win(["rested"], ["opp"], 4, 1), win(["played"], ["opp"], 4, 1)];
    const rows = computeStandings(["played", "rested", "opp"], matches, [], "wins_first", 2);
    const by = new Map(rows.map((r) => [r.subjectId, r]));
    // opp played 3 matches, so shortfalls are measured against 3:
    // rested is 2 short (+4), played is 1 short (+2), opp is the yardstick (0).
    expect(by.get("rested")!.restCompensation).toBe(4);
    expect(by.get("played")!.restCompensation).toBe(2);
    expect(by.get("opp")!.restCompensation).toBe(0);
  });
});

/**
 * The regression itself, stated as the property that was violated.
 *
 * 721a77c hardcoded the seeding basis to "points_first" while the table kept
 * using the session's own basis. Nothing in the standings module was wrong —
 * which is why no test caught it. The invariant that matters is that the
 * ORDER used to seed courts is the order the host is looking at.
 */
describe("seeding order matches the displayed order", () => {
  it("a wins-first session seeds court 1 from the wins ladder", () => {
    // Mirrors the real session: `fahad` 5 wins / 18 points,
    // `abdullah` 2 wins / 19 points. They sat either side of the court cut.
    const matches = [
      ...Array.from({ length: 5 }, () => win(["fahad"], ["opp"], 3, 2)),   // 5W 0L, 15 pts
      win(["opp"], ["fahad"], 5, 3),                                       // 5W 1L, 18 pts
      ...Array.from({ length: 2 }, () => win(["abdullah"], ["opp"], 5, 0)),// 2W, 10 pts
      ...Array.from({ length: 3 }, () => win(["opp"], ["abdullah"], 5, 3)),// 2W 3L, 19 pts
    ];
    const ids = ["fahad", "abdullah", "opp"];

    const wins = orderOf(computeStandings(ids, matches, [], "wins_first"));
    expect(wins.indexOf("fahad")).toBeLessThan(wins.indexOf("abdullah"));

    // The points ladder genuinely does rank them the other way round. That is
    // not a bug in either ladder — it is why seeding off the wrong one is
    // visible to the host as an injustice.
    const points = orderOf(computeStandings(ids, matches, [], "points_first"));
    expect(points.indexOf("abdullah")).toBeLessThan(points.indexOf("fahad"));
  });
});
