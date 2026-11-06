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
import { regenerateCurrentRound, deleteCurrentRound } from "../roundActions";

/**
 * Refresh / Randomize on ROUND 1 (Nov 2026). Hamud: a player hasn't arrived,
 * the host marks them "not here yet" — and before this, nobody but an admin
 * could redraw the first round without them.
 */

const SID = "5e550000-0000-0000-0000-0000000000aa";
const R1 = "r1000000-0000-0000-0000-000000000001";
const C1 = "c1000000-0000-0000-0000-000000000001";
const C2 = "c1000000-0000-0000-0000-000000000002";
const P = ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => `p100000${x}-0000-0000-0000-000000000000`);

function night(format: "mexicano" | "mix_mexicano"): ScorerSession {
  return {
    session: { id: SID, name: "Night", format, scoring_format: "fixed_21", ranking_basis: "points_first",
      fixed_partner_style: null, team_score_mode: null, min_players_per_court: 4, scheduling_seed: 7, status: "live",
      club_id: null, started_at: "2026-11-06T12:00:00Z", host_name: "H", is_host: true },
    courts: [{ id: C1, ordinal: 1, display_name: "Court 1", available: true }, { id: C2, ordinal: 2, display_name: "Court 2", available: true }],
    players: P.map((id, i) => ({ id, display_name: `P${i}`, gender: i % 2 ? "F" : "M", status: "active" as const, team_side: null,
      preferred_side: null, matches_played: 0, rests: 0, joined_at: `2026-11-06T12:00:0${i}Z`, linked_user_id: null, avatar_url: null })),
    pairs: [], round_rests: [], adjustments: [],
    rounds: [{ id: R1, sequence: 1, status: "in_progress", generation_reason: "initial", seed_used: 8, generated_at: "2026-11-06T12:00:00Z", added_by_scorer: null }],
    matches: [
      { id: "m1", round_id: R1, court_id: C1, pair_a_id: null, pair_b_id: null, status: "not_started", outcome: null, score_a: null, score_b: null, scored_at: null,
        participants: [{ player_id: P[0], side: "A" }, { player_id: P[1], side: "A" }, { player_id: P[2], side: "B" }, { player_id: P[3], side: "B" }] },
      { id: "m2", round_id: R1, court_id: C2, pair_a_id: null, pair_b_id: null, status: "not_started", outcome: null, score_a: null, score_b: null, scored_at: null,
        participants: [{ player_id: P[4], side: "A" }, { player_id: P[5], side: "A" }, { player_id: P[6], side: "B" }, { player_id: P[7], side: "B" }] },
    ],
  };
}

function hostPhone(format: "mexicano" | "mix_mexicano", notHere: string[] = []) {
  const g = graphFromScorerSession(night(format));
  g.syncedAt = 1;
  for (const p of g.players) if (notHere.includes(p.id)) p.status = "left";
  saveLocalSession(g);
}

const seated = () => {
  const s = getLocalSession(SID)!;
  const r = s.rounds[0];
  const ids = new Set(s.matches.filter((m) => m.round_id === r.id).map((m) => m.id));
  return s.participants.filter((p) => ids.has(p.match_id)).map((p) => p.player_id);
};

beforeEach(() => localStorage.clear());

describe("redrawing round 1", () => {
  it("Refresh leaves out the player marked not here, and stays round 1", async () => {
    hostPhone("mexicano", [P[3]]);
    const res = await regenerateCurrentRound(SID, { randomize: false });
    const s = getLocalSession(SID)!;
    expect(res.sequence).toBe(1);
    expect(s.rounds.map((r) => r.sequence)).toEqual([1]);
    expect(s.rounds[0].id).not.toBe(R1);
    expect(seated()).not.toContain(P[3]);
    // 7 present: one full court, three rest — and the old round is named for the server to drop.
    expect(seated().length).toBe(4);
    expect(s.discardedRoundIds).toContain(R1);
  });

  it("Randomize works on round 1 too, for Mix Mexicano", async () => {
    hostPhone("mix_mexicano");
    const res = await regenerateCurrentRound(SID, { randomize: true });
    expect(res.sequence).toBe(1);
    expect(new Set(seated()).size).toBe(8);
  });

  it("someone who joined after the start is put in", async () => {
    hostPhone("mexicano", [P[7]]); // 7 active: P[7] "not here"
    const s = getLocalSession(SID)!;
    s.players.find((p) => p.id === P[7])!.status = "active"; // they arrived
    saveLocalSession(s);
    await regenerateCurrentRound(SID, { randomize: false });
    expect(seated()).toContain(P[7]);
  });

  it("Delete still refuses on round 1 — there's nothing to go back to", async () => {
    hostPhone("mexicano");
    await expect(deleteCurrentRound(SID)).rejects.toThrow(/first round/);
  });
});
