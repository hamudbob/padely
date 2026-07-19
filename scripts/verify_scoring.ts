import { validateAndDeriveScore, scoreRangeForFormat } from "../src/lib/scoring/formats";
import { computeStandings } from "../src/lib/scoring/standings";

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ok   ${msg}`); }
  else { fail++; console.log(`  FAIL ${msg}`); }
}

console.log("\n=== PRD Acceptance test #2: Fixed 21, enter 12 -> 12-9 ===");
{
  const r = validateAndDeriveScore("fixed_21", { scoreA: 12, scoreB: null });
  assert(r.valid && r.derivedScoreB === 9, `enter 12 -> derived B = ${r.derivedScoreB} (expect 9)`);
  assert(r.outcome === "win_a", `outcome = ${r.outcome} (expect win_a)`);
}

console.log("\n=== PRD Acceptance test #3: game formats ===");
{
  const r4draw = validateAndDeriveScore("fixed_4_games", { scoreA: 2, scoreB: 2 });
  assert(r4draw.valid && r4draw.outcome === "draw", `fixed_4_games 2-2 valid draw: ${JSON.stringify(r4draw)}`);
  const r4bad = validateAndDeriveScore("fixed_4_games", { scoreA: 3, scoreB: 3 });
  assert(!r4bad.valid, `fixed_4_games 3-3 rejected (sum != 4): ${r4bad.error}`);
  const r5 = validateAndDeriveScore("fixed_5_games", { scoreA: 3, scoreB: 2 });
  assert(r5.valid && r5.outcome === "win_a", `fixed_5_games 3-2 valid win_a: ${JSON.stringify(r5)}`);
  const r5bad = validateAndDeriveScore("fixed_5_games", { scoreA: 3, scoreB: 3 });
  assert(!r5bad.valid, `fixed_5_games 3-3 rejected (sum != 5): ${r5bad.error}`);
  const race4ok = validateAndDeriveScore("race_4", { scoreA: 4, scoreB: 2 });
  assert(race4ok.valid && race4ok.outcome === "win_a", `race_4 4-2 valid: ${JSON.stringify(race4ok)}`);
  const race4bad = validateAndDeriveScore("race_4", { scoreA: 5, scoreB: 3 });
  assert(!race4bad.valid, `race_4 5-3 rejected (winner must be exactly 4): ${race4bad.error}`);
  const race6ok = validateAndDeriveScore("race_6", { scoreA: 3, scoreB: 6 });
  assert(race6ok.valid && race6ok.outcome === "win_b", `race_6 3-6 valid win_b: ${JSON.stringify(race6ok)}`);
}

console.log("\n=== Score picker range per format ===");
{
  assert(JSON.stringify(scoreRangeForFormat("fixed_21")) === JSON.stringify({ min: 0, max: 21 }), "fixed_21 range 0-21");
  assert(JSON.stringify(scoreRangeForFormat("race_6")) === JSON.stringify({ min: 0, max: 6 }), "race_6 range 0-6");
}

console.log("\n=== Standings: points-first sort, adjustments, head-to-head tiebreak ===");
{
  const matches = [
    { matchId: "m1", sideA: ["Ana"], sideB: ["Ben"], scoreA: 21, scoreB: 15, outcome: "win_a" as const },
    { matchId: "m2", sideA: ["Ana"], sideB: ["Carla"], scoreA: 10, scoreB: 21, outcome: "win_b" as const },
    { matchId: "m3", sideA: ["Ben"], sideB: ["Carla"], scoreA: 21, scoreB: 18, outcome: "win_a" as const },
  ];
  const standings = computeStandings(["Ana", "Ben", "Carla"], matches, [{ subjectId: "Ben", amount: 5 }], "points_first");
  const ana = standings.find((s) => s.subjectId === "Ana")!;
  const ben = standings.find((s) => s.subjectId === "Ben")!;
  assert(ana.points === 31, `Ana raw points = ${ana.points} (expect 31 = 21+10)`);
  assert(ben.totalPoints === ben.points + 5, `Ben adjustment applied: totalPoints=${ben.totalPoints}, points=${ben.points}`);
  assert(standings[0].rank === 1, "top standing has rank 1");
  // Ana: 31, Ben: 21+21+5(adj)=47, Carla: 21+18=39 -> order should be Ben, Carla, Ana
  const order = standings.map((s) => s.subjectId).join(",");
  assert(order === "Ben,Carla,Ana", `sort order = ${order} (expect Ben,Carla,Ana)`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) process.exit(1);
