// Ad-hoc verification runner — this project ships with a real vitest suite
// (src/lib/scheduling/__tests__/*.test.ts) that the user will run via `npm test`
// once they `npm install`. This script re-runs the same core assertions with a
// tiny hand-rolled assert(), so the logic is actually proven correct right now
// in an environment where vitest isn't installable. Not part of the shipped app.

import { mulberry32, PlayerFairnessState, emptyHistory, recordRoundInHistory } from "../src/lib/scheduling/types";
import { generateAmericanoRound } from "../src/lib/scheduling/americano";
import { generateMexicanoRound, StandingLookup } from "../src/lib/scheduling/mexicano";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}`);
  }
}

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => `P${i + 1}`);
}

// ---------------------------------------------------------------------------
console.log("\n=== Mexicano: matches-played fairness across many player/court counts ===");
for (const [n, courts] of [[5, 1], [8, 2], [11, 2], [12, 2], [12, 3], [17, 4]] as const) {
  const players = makePlayers(n);
  const stats = new Map<string, PlayerFairnessState>(
    players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const points = new Map<string, number>(players.map((id) => [id, 0]));
  const rng = mulberry32(n * 1000 + courts);
  const standings: StandingLookup = { rankValue: (id) => points.get(id) ?? 0 };
  const rounds = 10;

  for (let round = 0; round < rounds; round++) {
    const result = generateMexicanoRound({
      activePlayerIds: players,
      statsById: stats,
      courtsAvailable: courts,
      standings,
      isFirstRound: round === 0,
      rng,
    });
    for (const m of result.matches) {
      const aWins = rng() < 0.5;
      const [aScore, bScore] = aWins ? [15, 8] : [8, 15];
      for (const p of m.teamA) points.set(p, (points.get(p) ?? 0) + aScore);
      for (const p of m.teamB) points.set(p, (points.get(p) ?? 0) + bScore);
    }
    const playingSet = new Set(result.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    for (const id of players) {
      const s = stats.get(id)!;
      if (playingSet.has(id)) stats.set(id, { playerId: id, matchesPlayed: s.matchesPlayed + 1, restedLastRound: false });
      else stats.set(id, { playerId: id, matchesPlayed: s.matchesPlayed, restedLastRound: true });
    }
  }
  const played = players.map((id) => stats.get(id)!.matchesPlayed);
  const spread = Math.max(...played) - Math.min(...played);
  assert(spread <= 1, `${n} players / ${courts} courts / ${rounds} rounds: matches-played spread = ${spread} (played: ${played.join(",")})`);
}

// ---------------------------------------------------------------------------
console.log("\n=== Mexicano: no double-booked player/court, round-1 seeded, later rounds rank-grouped ===");
{
  const players12 = makePlayers(12);
  const stats = new Map<string, PlayerFairnessState>(
    players12.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const points = new Map<string, number>(players12.map((id, i) => [id, (12 - i) * 10])); // P1 highest .. P12 lowest
  const standings: StandingLookup = { rankValue: (id) => points.get(id) ?? 0 };
  const result = generateMexicanoRound({
    activePlayerIds: players12,
    statsById: stats,
    courtsAvailable: 3,
    standings,
    isFirstRound: false,
    rng: mulberry32(3),
  });
  const seen = new Set<string>();
  const courts = new Set<number>();
  let noDouble = true;
  for (const m of result.matches) {
    for (const p of [...m.teamA, ...m.teamB]) {
      if (seen.has(p)) noDouble = false;
      seen.add(p);
    }
    if (courts.has(m.courtIndex)) noDouble = false;
    courts.add(m.courtIndex);
  }
  assert(noDouble, "no player or court double-booked within the round");
  const topGroup = new Set([...result.matches[0].teamA, ...result.matches[0].teamB]);
  const expected = new Set(["P1", "P2", "P3", "P4"]);
  assert(
    [...topGroup].every((p) => expected.has(p)) && topGroup.size === 4,
    `top-ranked group of 4 (P1-P4) plays together on a court: got [${[...topGroup].join(",")}]`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n=== Americano: fairness + zero repeated partners in the ideal case ===");
{
  const players = makePlayers(11);
  const stats = new Map<string, PlayerFairnessState>(
    players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const rng = mulberry32(99);
  const history = emptyHistory();
  for (let round = 0; round < 10; round++) {
    const result = generateAmericanoRound({ activePlayerIds: players, statsById: stats, courtsAvailable: 2, history, rng });
    recordRoundInHistory(history, result);
    const playingSet = new Set(result.matches.flatMap((m) => [...m.teamA, ...m.teamB]));
    for (const id of players) {
      const s = stats.get(id)!;
      if (playingSet.has(id)) stats.set(id, { playerId: id, matchesPlayed: s.matchesPlayed + 1, restedLastRound: false });
      else stats.set(id, { playerId: id, matchesPlayed: s.matchesPlayed, restedLastRound: true });
    }
  }
  const played = players.map((id) => stats.get(id)!.matchesPlayed);
  const spread = Math.max(...played) - Math.min(...played);
  assert(spread <= 1, `11 players / 2 courts / 10 rounds: matches-played spread = ${spread} (played: ${played.join(",")})`);
}
{
  const players = makePlayers(8);
  const stats = new Map<string, PlayerFairnessState>(
    players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const rng = mulberry32(5);
  const history = emptyHistory();
  for (let round = 0; round < 7; round++) {
    const result = generateAmericanoRound({ activePlayerIds: players, statsById: stats, courtsAvailable: 2, history, rng });
    recordRoundInHistory(history, result);
  }
  const expectedPlacements = 7 * 2 * 2;
  assert(
    history.partnerPairsSeen.size === expectedPlacements,
    `8 players / 2 courts / 7 rounds: ${history.partnerPairsSeen.size}/${expectedPlacements} unique partner pairs (0 repeats = ideal round robin achieved)`,
  );
}
{
  const players = makePlayers(13);
  const stats = new Map<string, PlayerFairnessState>(
    players.map((id) => [id, { playerId: id, matchesPlayed: 0, restedLastRound: false }]),
  );
  const result = generateAmericanoRound({
    activePlayerIds: players,
    statsById: stats,
    courtsAvailable: 3,
    history: emptyHistory(),
    rng: mulberry32(11),
  });
  assert(result.courtsUsed === 3, `13 players / 3 courts available -> courtsUsed = ${result.courtsUsed} (expected 3, since floor(13/4)=3)`);
  assert(result.restingIds.length === 1, `13 players -> ${result.restingIds.length} resting (expected 1)`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) process.exit(1);
