// One whole-night balancer for every pre-drawn format (Nov 2026).
//
// THE MISTAKE IT EXISTS TO PREVENT. A user's Fixed Partner night had one pair
// meet another three times while two pairs never met. Measured the same way,
// Mix Americano and Team Sparring had players partnering one person three
// times while never partnering someone they could have, and every format left
// opponents badly uneven. Each round was built on its own, so the night could
// paint itself into a corner no single round could see.
//
// So every pre-drawn schedule is drawn round by round as before (that keeps
// the rests fair as it goes), then this pass reworks the whole night at once,
// with the same priorities in every format, in this order:
//
//   1. Games stay level all night: after every round, the most-played and
//      least-played differ by at most one. Nobody rests twice before everyone
//      has rested once.
//   2. Nobody gets the same partner again while there's someone they could
//      have partnered and haven't (a "gap" of 2: one partner twice, another
//      never). Partner counts as even as possible.
//   3. The same for opponents, at a lower weight.
//   4. Nobody rests two rounds running when it can be avoided.
//   5. Format rules that are preferences, not walls (Mix: one man and one
//      woman per team), weighted so they're only broken when the numbers
//      leave no choice.
//
// It also takes what has ALREADY happened (`prior`), so the same rules hold
// across the whole night when rounds are redrawn or added later, not just
// within the rounds being drawn.

import { MatchHistory, PlayerId, RoundResult, Rng, pairKey, emptyHistory, mulberry32, recordRoundInHistory } from "./types";

export interface BalanceRules {
  /** May these two players trade places? Only swaps that keep the format valid
   *  (Team Sparring: same team). */
  canSwap(a: PlayerId, b: PlayerId): boolean;
  /** Could these two ever be partners? (Mix: man + woman. Team Sparring: same team.) */
  partnerEligible(a: PlayerId, b: PlayerId): boolean;
  /** Could these two ever face each other? (Team Sparring: different teams.) */
  opponentEligible(a: PlayerId, b: PlayerId): boolean;
  /** Cost of a team that breaks a soft rule (Mix: two men). 0 when fine. */
  teamPenalty?(a: PlayerId, b: PlayerId): number;
  /** Games are kept level within each group (Team Sparring: per team, since
   *  the teams can differ in size). Default: everyone is one group. */
  group?(a: PlayerId): string;
}

/** What already happened before the rounds being drawn. */
export interface SchedulePrior {
  history: MatchHistory;
  playCounts: Map<PlayerId, number>;
  /** Players who sat out the most recent round already played or planned. */
  restedLast: Set<PlayerId>;
}

export function emptyPrior(): SchedulePrior {
  return { history: emptyHistory(), playCounts: new Map(), restedLast: new Set() };
}

/** Builds a prior from rounds that already exist, oldest first. */
export function priorFromRounds(rounds: RoundResult[]): SchedulePrior {
  const prior = emptyPrior();
  for (const r of rounds) {
    recordRoundInHistory(prior.history, r);
    const playing = new Set<PlayerId>();
    for (const m of r.matches) for (const id of [...m.teamA, ...m.teamB]) playing.add(id);
    for (const id of playing) prior.playCounts.set(id, (prior.playCounts.get(id) ?? 0) + 1);
    prior.restedLast = new Set(r.restingIds.filter((id) => !playing.has(id)));
  }
  return prior;
}

const W = {
  unfairRound: 200_000, // per (spread - 1)² after any round
  partner: 1_000, // per count²
  partnerGap: 60_000, // per (gap - 1)² per player
  opponent: 40, // per count²
  opponentGap: 4_000, // per (gap - 1)² per player
  restAgain: 2_500, // resting two rounds running
  team: 300_000, // per team that breaks a soft format rule (above fairness: mixing is the format)
};

/**
 * Reworks `rounds` in place. Deterministic for a given rng. Returns the final
 * objective (lower is better), so callers can compare several attempts.
 */
export function balanceSchedule(
  rounds: RoundResult[],
  players: PlayerId[],
  rules: BalanceRules,
  prior: SchedulePrior,
  rng: Rng,
  iterations: number,
): number {
  const n = players.length;
  if (n === 0 || rounds.length === 0) return 0;
  const idx = new Map(players.map((p, i) => [p, i]));

  // Static per-pair facts and the prior, as flat arrays (n ≤ ~40).
  const partnerOk = new Uint8Array(n * n);
  const opponentOk = new Uint8Array(n * n);
  const priorPc = new Int32Array(n * n);
  const priorOc = new Int32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      partnerOk[i * n + j] = rules.partnerEligible(players[i], players[j]) ? 1 : 0;
      opponentOk[i * n + j] = rules.opponentEligible(players[i], players[j]) ? 1 : 0;
      priorPc[i * n + j] = prior.history.partnerCounts.get(pairKey(players[i], players[j])) ?? 0;
      priorOc[i * n + j] = prior.history.opponentCounts.get(pairKey(players[i], players[j])) ?? 0;
    }
  }
  const hasTeamPenalty = !!rules.teamPenalty;
  const teamPen = new Float64Array(n * n);
  if (rules.teamPenalty) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) teamPen[i * n + j] = rules.teamPenalty(players[i], players[j]);
  }
  const priorPlay = new Int32Array(n);
  const priorRested = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    priorPlay[i] = prior.playCounts.get(players[i]) ?? 0;
    priorRested[i] = prior.restedLast.has(players[i]) ? 1 : 0;
  }

  const groupKeys = players.map((p) => (rules.group ? rules.group(p) : ""));
  const groupNames = [...new Set(groupKeys)];
  const groupOf = new Int32Array(n);
  for (let i = 0; i < n; i++) groupOf[i] = groupNames.indexOf(groupKeys[i]);
  const gLo = new Int32Array(groupNames.length);
  const gHi = new Int32Array(groupNames.length);

  // The night as flat index arrays: slots[r] holds each court's four players
  // in order (team A, team A, team B, team B); bench[r] who's resting.
  const slots: Int32Array[] = [];
  const bench: Int32Array[] = [];
  for (const r of rounds) {
    const sl = new Int32Array(r.matches.length * 4);
    r.matches.forEach((m, j) => {
      sl[j * 4] = idx.get(m.teamA[0]) ?? -1;
      sl[j * 4 + 1] = idx.get(m.teamA[1]) ?? -1;
      sl[j * 4 + 2] = idx.get(m.teamB[0]) ?? -1;
      sl[j * 4 + 3] = idx.get(m.teamB[1]) ?? -1;
    });
    const be = Int32Array.from(r.restingIds.map((id) => idx.get(id) ?? -1));
    // Someone the rules don't know about: leave the night exactly as drawn.
    if (sl.some((v) => v < 0) || be.some((v) => v < 0)) return Infinity;
    slots.push(sl);
    bench.push(be);
  }
  const swapOk = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) swapOk[i * n + j] = i === j || rules.canSwap(players[i], players[j]) ? 1 : 0;

  const pc = new Int32Array(n * n);
  const oc = new Int32Array(n * n);
  const play = new Int32Array(n);
  const rested = new Uint8Array(n);
  const restedNow = new Uint8Array(n);

  const objective = (): number => {
    pc.set(priorPc);
    oc.set(priorOc);
    play.set(priorPlay);
    rested.set(priorRested);
    let f = 0;
    for (let r = 0; r < slots.length; r++) {
      const sl = slots[r];
      restedNow.fill(1);
      for (let q = 0; q < sl.length; q += 4) {
        const a0 = sl[q], a1 = sl[q + 1], b0 = sl[q + 2], b1 = sl[q + 3];
        pc[a0 * n + a1]++; pc[a1 * n + a0]++;
        pc[b0 * n + b1]++; pc[b1 * n + b0]++;
        oc[a0 * n + b0]++; oc[b0 * n + a0]++;
        oc[a0 * n + b1]++; oc[b1 * n + a0]++;
        oc[a1 * n + b0]++; oc[b0 * n + a1]++;
        oc[a1 * n + b1]++; oc[b1 * n + a1]++;
        play[a0]++; play[a1]++; play[b0]++; play[b1]++;
        restedNow[a0] = 0; restedNow[a1] = 0; restedNow[b0] = 0; restedNow[b1] = 0;
        if (hasTeamPenalty) f += W.team * (teamPen[a0 * n + a1] + teamPen[b0 * n + b1]);
      }
      // 1. Fair after EVERY round, not just in total (within each group).
      gLo.fill(1 << 30);
      gHi.fill(-1);
      for (let i = 0; i < n; i++) {
        const g = groupOf[i];
        if (play[i] < gLo[g]) gLo[g] = play[i];
        if (play[i] > gHi[g]) gHi[g] = play[i];
      }
      for (let g = 0; g < groupNames.length; g++) {
        const over = gHi[g] - gLo[g] - 1;
        if (over > 0) f += W.unfairRound * over * over;
      }
      // 4. Resting twice running.
      for (let i = 0; i < n; i++) {
        if (restedNow[i] && rested[i]) f += W.restAgain;
      }
      rested.set(restedNow);
    }
    // 2 and 3. Even partners and opponents, and no "gap" of 2.
    for (let i = 0; i < n; i++) {
      let pMax = -1, pMin = 1 << 30, oMax = -1, oMin = 1 << 30;
      const row = i * n;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const k = row + j;
        const p = pc[k], o = oc[k];
        if (j > i) f += W.partner * p * p + W.opponent * o * o;
        if (partnerOk[k]) {
          if (p > pMax) pMax = p;
          if (p < pMin) pMin = p;
        }
        if (opponentOk[k]) {
          if (o > oMax) oMax = o;
          if (o < oMin) oMin = o;
        }
      }
      const pGap = pMax - pMin - 1;
      if (pMax >= 0 && pGap > 0) f += W.partnerGap * pGap * pGap;
      const oGap = oMax - oMin - 1;
      if (oMax >= 0 && oGap > 0) f += W.opponentGap * oGap * oGap;
    }
    return f;
  };

  let cur = objective();
  let best = cur;
  const bestSlots = slots.map((x) => x.slice());
  const bestBench = bench.map((x) => x.slice());
  const T0 = Math.max(50, cur * 0.02);
  for (let it = 0; it < iterations; it++) {
    const r = Math.floor(rng() * slots.length);
    const sl = slots[r];
    const be = bench[r];
    const courts = sl.length / 4;
    if (courts === 0) continue;
    const T = T0 * Math.pow(1 - it / iterations, 2);
    // Every move swaps two positions (u, v), each either a court slot or a
    // bench spot; t1/t2 mark a whole-team move (second positions u2, v2).
    let u = -1, v = -1, u2 = -1, v2 = -1;
    let uBench = false, vBench = false;

    const pick = rng();
    if (courts >= 2 && pick < 0.3) {
      // Two teams on different courts trade places: partnerships stay exactly
      // as they are, only who faces whom changes. Single-player swaps can't
      // fix opponents without first breaking a good partnership, so without
      // this move the search stalls with opponents badly uneven.
      const c1 = Math.floor(rng() * courts);
      let c2 = Math.floor(rng() * (courts - 1));
      if (c2 >= c1) c2++;
      u = c1 * 4 + (rng() < 0.5 ? 0 : 2);
      v = c2 * 4 + (rng() < 0.5 ? 0 : 2);
      u2 = u + 1;
      v2 = v + 1;
      if (!swapOk[sl[u] * n + sl[v]] || !swapOk[sl[u2] * n + sl[v2]]) continue;
    } else if (be.length > 0 && pick < 0.6) {
      // An on-court player trades places with someone resting.
      u = Math.floor(rng() * sl.length);
      v = Math.floor(rng() * be.length);
      vBench = true;
      if (!swapOk[sl[u] * n + be[v]]) continue;
    } else {
      // Two on-court players in the same round trade places.
      u = Math.floor(rng() * sl.length);
      v = Math.floor(rng() * sl.length);
      if (u === v || !swapOk[sl[u] * n + sl[v]]) continue;
    }

    const swap = () => {
      const a = uBench ? be[u] : sl[u];
      const b = vBench ? be[v] : sl[v];
      if (uBench) be[u] = b; else sl[u] = b;
      if (vBench) be[v] = a; else sl[v] = a;
      if (u2 >= 0) {
        const x = sl[u2];
        sl[u2] = sl[v2];
        sl[v2] = x;
      }
    };
    swap();
    const next = objective();
    const delta = next - cur;
    if (delta <= 0 || (T > 0 && rng() < Math.exp(-delta / T))) {
      cur = next;
      if (cur < best) {
        best = cur;
        for (let k = 0; k < slots.length; k++) {
          bestSlots[k].set(slots[k]);
          bestBench[k].set(bench[k]);
        }
      }
    } else {
      swap(); // a swap undoes itself
    }
  }

  // Write the best night back into the rounds.
  rounds.forEach((r, k) => {
    const sl = bestSlots[k];
    r.matches.forEach((m, j) => {
      m.teamA = [players[sl[j * 4]], players[sl[j * 4 + 1]]];
      m.teamB = [players[sl[j * 4 + 2]], players[sl[j * 4 + 3]]];
    });
    r.restingIds = Array.from(bestBench[k], (i) => players[i]);
  });
  return best;
}

/**
 * Balances each starting schedule and keeps the best. The round-by-round draw
 * is always one start; when everyone plays every round the formats add a
 * textbook rotation (below) as another, because the optimiser can then keep
 * its perfect partners and only rearrange opponents.
 */
export function balanceBestOf(
  starts: RoundResult[][],
  players: PlayerId[],
  rules: BalanceRules,
  prior: SchedulePrior,
  seed: number,
): RoundResult[] {
  let best: RoundResult[] = [];
  let bestScore = Infinity;
  starts.forEach((rounds, i) => {
    if (rounds.length === 0) return;
    const score = balanceSchedule(rounds, players, rules, prior, mulberry32(seed + 99991 + i * 7919), balanceIterations(rounds.length, players.length));
    if (score < bestScore) {
      bestScore = score;
      best = rounds;
    }
  });
  for (const r of best) r.matches.forEach((m, i) => (m.courtIndex = i));
  return best;
}

/**
 * Round-robin "circle method": the pairs for round `r` of a rotation in which
 * everyone partners everyone else exactly once every n - 1 rounds (n even).
 * One player stays put and the rest turn around them like a clock.
 */
export function circlePairs(ids: PlayerId[], r: number): [PlayerId, PlayerId][] {
  const n = ids.length;
  if (n < 2 || n % 2 === 1) return [];
  const m = n - 1;
  const rot = ids.slice(1);
  const k = ((r % m) + m) % m;
  const pairs: [PlayerId, PlayerId][] = [[ids[0], rot[k]]];
  for (let i = 1; i < n / 2; i++) pairs.push([rot[(k + i) % m], rot[(k - i + m) % m]]);
  return pairs;
}

/** A seeded shuffle, so two nights with the same players don't look alike. */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Rounds made from teams (two per court, in order), nobody resting. */
export function roundFromTeams(teams: [PlayerId, PlayerId][]): RoundResult {
  const matches = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    matches.push({ courtIndex: i / 2, teamA: [...teams[i]] as [PlayerId, PlayerId], teamB: [...teams[i + 1]] as [PlayerId, PlayerId] });
  }
  return {
    courtsUsed: matches.length,
    matches,
    restingIds: [],
    explanation: `All ${matches.length * 4} players are on court this round across ${matches.length} court${matches.length > 1 ? "s" : ""}.`,
  };
}

/** How many optimiser steps a night of this size gets. */
export function balanceIterations(rounds: number, players: number): number {
  return Math.min(70_000, Math.max(12_000, rounds * players * 260));
}

/** The worst partner and opponent "gap" of a schedule, for tests and the
 *  host's pre-start check: the most times any player had one partner minus
 *  the fewest times they had another they could have had. 1 or less is the
 *  promise; 2 is the mistake this file exists to prevent. */
export function scheduleGaps(rounds: RoundResult[], players: PlayerId[], rules: BalanceRules, prior: SchedulePrior = emptyPrior()) {
  const h: MatchHistory = {
    partnerPairsSeen: new Set(prior.history.partnerPairsSeen),
    opponentPairsSeen: new Set(prior.history.opponentPairsSeen),
    partnerCounts: new Map(prior.history.partnerCounts),
    opponentCounts: new Map(prior.history.opponentCounts),
  };
  for (const r of rounds) recordRoundInHistory(h, r);
  let partnerGap = 0;
  let opponentGap = 0;
  for (const p of players) {
    const pc = players.filter((q) => q !== p && rules.partnerEligible(p, q)).map((q) => h.partnerCounts.get(pairKey(p, q)) ?? 0);
    const oc = players.filter((q) => q !== p && rules.opponentEligible(p, q)).map((q) => h.opponentCounts.get(pairKey(p, q)) ?? 0);
    if (pc.length) partnerGap = Math.max(partnerGap, Math.max(...pc) - Math.min(...pc));
    if (oc.length) opponentGap = Math.max(opponentGap, Math.max(...oc) - Math.min(...oc));
  }
  return { partnerGap, opponentGap };
}
