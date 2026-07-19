import { describe, it, expect } from "vitest";
import { mulberry32 } from "../types";
import {
  formPairsRandom,
  formPairsByPosition,
  generateFixedPartnerSchedule,
  buildPairByPlayerId,
  SidedPlayer,
} from "../fixedPartner";

function makePlayers(n: number, prefix = "P") {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

describe("Fixed Partner pair formation", () => {
  it("formPairsRandom pairs every player exactly once", () => {
    const players = makePlayers(8);
    const pairs = formPairsRandom(players, mulberry32(1));
    expect(pairs.length).toBe(4);
    const seen = new Set<string>();
    for (const p of pairs) {
      seen.add(p.playerA);
      seen.add(p.playerB);
    }
    expect(seen.size).toBe(8);
  });

  it("formPairsByPosition pairs left-right first, then leftovers together (best-effort)", () => {
    const sided: SidedPlayer[] = [
      { id: "L1", side: "left" },
      { id: "L2", side: "left" },
      { id: "L3", side: "left" },
      { id: "R1", side: "right" },
      { id: "R2", side: "right" },
    ];
    const pairs = formPairsByPosition(sided, mulberry32(2));
    expect(pairs.length).toBe(2); // 5 players -> 2 pairs, 1 left unpaired (odd total)
    let crossSideCount = 0;
    for (const p of pairs) {
      const aSide = sided.find((s) => s.id === p.playerA)?.side;
      const bSide = sided.find((s) => s.id === p.playerB)?.side;
      if (aSide !== bSide) crossSideCount++;
    }
    // min(3 lefts, 2 rights) = 2 cross-side pairs possible; the 3rd left is odd one out.
    expect(crossSideCount).toBe(2);
  });
});

describe("Fixed Partner round generation", () => {
  it("never splits a pair — every match's team is exactly one pair's two members", () => {
    const players = makePlayers(8);
    const pairs = formPairsRandom(players, mulberry32(1));
    const schedule = generateFixedPartnerSchedule({ pairs, courtsAvailable: 2, roundCount: 3, schedulingSeed: 42 });
    for (const round of schedule) {
      for (const m of round.matches) {
        const teamAIsPair = pairs.some(
          (p) =>
            (p.playerA === m.teamA[0] && p.playerB === m.teamA[1]) ||
            (p.playerA === m.teamA[1] && p.playerB === m.teamA[0]),
        );
        const teamBIsPair = pairs.some(
          (p) =>
            (p.playerA === m.teamB[0] && p.playerB === m.teamB[1]) ||
            (p.playerA === m.teamB[1] && p.playerB === m.teamB[0]),
        );
        expect(teamAIsPair).toBe(true);
        expect(teamBIsPair).toBe(true);
      }
    }
  });

  it("achieves zero repeated pair-vs-pair matchups for the ideal case (4 pairs, 2 courts, 3 rounds)", () => {
    // 4 pairs, 2 matches/round, 3 rounds = 6 matchup placements. C(4,2)=6 possible
    // pair-vs-pair combos exist, so an ideal run covers each exactly once.
    const players = makePlayers(8);
    const pairs = formPairsRandom(players, mulberry32(1));
    const schedule = generateFixedPartnerSchedule({ pairs, courtsAvailable: 2, roundCount: 3, schedulingSeed: 42 });
    const pairByPlayerId = buildPairByPlayerId(pairs);
    const seenMatchups = new Set<string>();
    let repeats = 0;
    for (const round of schedule) {
      for (const m of round.matches) {
        const a = pairByPlayerId.get(m.teamA[0])!;
        const b = pairByPlayerId.get(m.teamB[0])!;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seenMatchups.has(key)) repeats++;
        seenMatchups.add(key);
      }
    }
    expect(repeats).toBe(0);
  });

  it("rests exactly one pair when pair count is odd relative to courts (5 pairs, 2 courts)", () => {
    const players = makePlayers(10, "Q");
    const pairs = formPairsRandom(players, mulberry32(3));
    const schedule = generateFixedPartnerSchedule({ pairs, courtsAvailable: 2, roundCount: 4, schedulingSeed: 7 });
    for (const round of schedule) {
      expect(round.restingIds.length).toBe(2); // one resting pair = 2 players
    }
  });

  it("returns zero rounds when there aren't enough pairs for a single court", () => {
    const players = makePlayers(2, "S");
    const pairs = formPairsRandom(players, mulberry32(4)); // 1 pair, needs 2 for a court
    const schedule = generateFixedPartnerSchedule({ pairs, courtsAvailable: 2, roundCount: 3, schedulingSeed: 1 });
    expect(schedule.length).toBe(0);
  });
});
