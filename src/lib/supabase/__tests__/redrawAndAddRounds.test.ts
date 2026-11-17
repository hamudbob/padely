import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("../../supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: null, error: null }) },
}));

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

import { graphFromScorerSession, ScorerSession } from "../../offline/coHostMerge";
import { getLocalSession, saveLocalSession } from "../../offline/localSession";
import { addRounds, describeSequences, previewRedrawRemaining, redrawRemainingRounds, roundsForEvenGames } from "../roundActions";
import { generateInitialRounds } from "../../scheduling/initialSchedule";
import { pairKey } from "../../scheduling/types";

/**
 * Redraw and Add rounds for pre-drawn formats (Nov 2026). Hamud: "in americano,
 * when a player is not there yet, we usually just search where all players are
 * available and play that round — sometimes we skip some rounds and play them
 * later". So:
 *   - Redraw replaces only rounds with NO score, wherever they are, and keeps
 *     their numbers. Before, it kept everything up to the last scored round,
 *     so a round skipped earlier in the night was never redrawn.
 *   - Rounds are added several at a time, drawn to carry on the night.
 */

const SID = "5e550000-0000-0000-0000-0000000000bb";
const COURTS = ["c1", "c2", "c3"].map((x) => `${x}000000-0000-0000-0000-000000000001`);
const P = Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(7, "0")}-0000-0000-0000-000000000000`);

function americanoNight(): ScorerSession {
  const drawn = generateInitialRounds({
    players: P.map((id) => ({ id, gender: "M", teamSide: null })),
    courtsAvailable: 3,
    format: "americano",
    schedulingSeed: 77,
    roundCount: 11,
  });
  const rounds = drawn.map((_, i) => ({
    id: `r${String(i + 1).padStart(7, "0")}-0000-0000-0000-000000000000`,
    sequence: i + 1,
    status: i === 0 ? "in_progress" : "planned",
    generation_reason: "initial",
    seed_used: 78 + i,
    generated_at: "2026-11-16T12:00:00Z",
    added_by_scorer: null,
  }));
  const matches = drawn.flatMap((r, i) =>
    r.matches.map((m, j) => ({
      id: `m${i}-${j}`,
      round_id: rounds[i].id,
      court_id: COURTS[m.courtIndex],
      pair_a_id: null,
      pair_b_id: null,
      status: "not_started",
      outcome: null,
      score_a: null,
      score_b: null,
      scored_at: null,
      participants: [
        ...m.teamA.map((player_id) => ({ player_id, side: "A" })),
        ...m.teamB.map((player_id) => ({ player_id, side: "B" })),
      ],
    })),
  );
  return {
    session: { id: SID, name: "Night", format: "americano", scoring_format: "fixed_21", ranking_basis: "points_first",
      fixed_partner_style: null, team_score_mode: null, min_players_per_court: 4, scheduling_seed: 77, status: "live",
      club_id: null, started_at: "2026-11-16T12:00:00Z", host_name: "H", is_host: true },
    courts: COURTS.map((id, i) => ({ id, ordinal: i + 1, display_name: `Court ${i + 1}`, available: true })),
    players: P.map((id, i) => ({ id, display_name: `P${i}`, gender: "M", status: "active" as const, team_side: null,
      preferred_side: null, matches_played: 0, rests: 0, joined_at: `2026-11-16T12:00:${String(i).padStart(2, "0")}Z`, linked_user_id: null, avatar_url: null })),
    pairs: [], round_rests: [], adjustments: [],
    rounds,
    matches,
  } as unknown as ScorerSession;
}

function hostPhone() {
  const g = graphFromScorerSession(americanoNight());
  g.syncedAt = 1;
  saveLocalSession(g);
}

/** Scores every court of these rounds, as if they were played. */
function play(...sequences: number[]) {
  const s = getLocalSession(SID)!;
  const ids = new Set(s.rounds.filter((r) => sequences.includes(r.sequence)).map((r) => r.id));
  for (const m of s.matches) if (ids.has(m.round_id)) Object.assign(m, { score_a: 21, score_b: 15, status: "final", outcome: "a_win" });
  saveLocalSession(s);
}

function playersIn(sequence: number): string[] {
  const s = getLocalSession(SID)!;
  const r = s.rounds.find((x) => x.sequence === sequence)!;
  const ms = new Set(s.matches.filter((m) => m.round_id === r.id).map((m) => m.id));
  return s.participants.filter((p) => ms.has(p.match_id)).map((p) => p.player_id);
}

function partnerCounts(): Map<string, number> {
  const s = getLocalSession(SID)!;
  const c = new Map<string, number>();
  for (const m of s.matches) {
    const ps = s.participants.filter((p) => p.match_id === m.id);
    for (const side of ["A", "B"]) {
      const t = ps.filter((p) => p.side === side).map((p) => p.player_id);
      if (t.length === 2) c.set(pairKey(t[0], t[1]), (c.get(pairKey(t[0], t[1])) ?? 0) + 1);
    }
  }
  return c;
}

beforeEach(() => localStorage.clear());

describe("redraw: only rounds with no score, wherever they are", () => {
  it("rounds 1 and 3 played, 2 skipped: redraw takes 2 and 4–11 and leaves 1 and 3 alone", async () => {
    hostPhone();
    play(1, 3);
    const before = getLocalSession(SID)!.rounds.filter((r) => r.sequence === 1 || r.sequence === 3).map((r) => r.id);

    const preview = await previewRedrawRemaining(SID);
    expect(preview!.sequences).toEqual([2, 4, 5, 6, 7, 8, 9, 10, 11]);

    // P[11] went home.
    const s = getLocalSession(SID)!;
    s.players.find((p) => p.id === P[11])!.status = "left";
    saveLocalSession(s);

    const res = await redrawRemainingRounds(SID);
    expect(res.sequences).toEqual([2, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(res.players).toBe(11);

    const after = getLocalSession(SID)!;
    expect(after.rounds.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(after.rounds.filter((r) => r.sequence === 1 || r.sequence === 3).map((r) => r.id)).toEqual(before);
    for (const seq of res.sequences) expect(playersIn(seq)).not.toContain(P[11]);
    // Round 1 keeps its in-progress marker.
    expect(after.rounds.find((r) => r.sequence === 1)!.status).toBe("in_progress");
  });

  it("carries on from what was played: nobody partners someone twice while a partner is unused", async () => {
    hostPhone();
    play(2, 5, 6);
    await redrawRemainingRounds(SID);
    // 11 rounds × 12 players = everyone partners all 11 others once.
    const c = partnerCounts();
    expect(c.size).toBe(66);
    expect(Math.max(...c.values())).toBe(1);
  });

  it("nothing to redraw once every round has a score", async () => {
    hostPhone();
    play(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
    expect(await previewRedrawRemaining(SID)).toBeNull();
    await expect(redrawRemainingRounds(SID)).rejects.toThrow(/nothing left to redraw/);
  });
});

describe("add rounds", () => {
  it("adds several at once, numbered after the last, carrying on the balance", async () => {
    hostPhone();
    play(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
    const res = await addRounds(SID, 4);
    expect(res.sequences).toEqual([12, 13, 14, 15]);
    const s = getLocalSession(SID)!;
    expect(s.rounds.map((r) => r.sequence)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    for (const seq of res.sequences) expect(new Set(playersIn(seq)).size).toBe(12);
    // After a full round robin, the added rounds never give anyone the same
    // partner twice more (counts stay within 1 of each other: 1 or 2).
    expect(Math.max(...partnerCounts().values())).toBe(2);
  });

  it("refuses a silly count and a format that draws as it goes", async () => {
    hostPhone();
    await expect(addRounds(SID, 0)).rejects.toThrow(/between 1 and 30/);
    const s = getLocalSession(SID)!;
    s.session.format = "mexicano";
    saveLocalSession(s);
    await expect(addRounds(SID, 2)).rejects.toThrow(/next-round button/);
  });
});

describe("helpers", () => {
  it("round numbers the way a host says them", () => {
    expect(describeSequences([2, 4, 5, 6, 8])).toBe("2, 4–6, 8");
    expect(describeSequences([9, 10])).toBe("9, 10");
    expect(describeSequences([3])).toBe("3");
  });

  it("the fewest rounds that leave everyone on the same games", () => {
    // 13 players, 12 on court a round, everyone on 3 except one on 2.
    expect(roundsForEvenGames([{ counts: [...Array(12).fill(3), 2], perRound: 12 }])).toBe(12);
    // 10 players, 8 on court, two players a game behind: level again after 4 rounds.
    expect(roundsForEvenGames([{ counts: [...Array(8).fill(4), 3, 3], perRound: 8 }])).toBe(4);
    // Already even with everyone playing every round: one round keeps it even.
    expect(roundsForEvenGames([{ counts: Array(8).fill(5), perRound: 8 }])).toBe(1);
  });
});
