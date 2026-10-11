import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("../../supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => (globalThis as any).__fakeRpc(name, args) },
}));

// A browser, minimally (vitest runs these in node).
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

import { saveLocalSession, getLocalSession } from "../localSession";
import { replicateSession } from "../localSessionSync";
import { graphFromScorerSession, ScorerSession } from "../coHostMerge";

/**
 * The host's push, with co-hosts: pull first, then push what was merged —
 * so the push carries the co-host's work back up rather than arguing with it.
 */

const g = globalThis as any;
g.window = g;
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.document = { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} };

const SID = "5e550000-0000-0000-0000-000000000009";
const R1 = "r1";
const M1 = "m1";

function server(scored: boolean): ScorerSession {
  return {
    session: { id: SID, name: "Night", format: "mexicano", scoring_format: "fixed_21", ranking_basis: "points_first",
      fixed_partner_style: null, team_score_mode: null, min_players_per_court: 4, scheduling_seed: 1,
      status: "live", club_id: null, started_at: "2026-10-11T12:00:00Z", host_name: "H", is_host: true },
    courts: [{ id: "c1", ordinal: 1, display_name: "Court 1", available: true }],
    players: [], pairs: [], round_rests: [], adjustments: [],
    rounds: [{ id: R1, sequence: 1, status: "in_progress", generation_reason: "x", seed_used: 1,
               generated_at: "2026-10-11T12:00:00Z", added_by_scorer: null }],
    matches: [{ id: M1, round_id: R1, court_id: "c1", pair_a_id: null, pair_b_id: null,
      status: scored ? "final" : "not_started", outcome: scored ? "win_a" : null,
      score_a: scored ? 15 : null, score_b: scored ? 6 : null,
      scored_at: scored ? "2026-10-11T12:20:00Z" : null, participants: [] }],
  };
}

let calls: string[];
let pushed: any[];
let pullFails: boolean;

g.__fakeRpc = (name: string, args: any) => {
  calls.push(name);
  if (name === "get_scorer_session") {
    return Promise.resolve(pullFails ? { data: null, error: { message: "offline" } } : { data: server(true), error: null });
  }
  if (name === "sync_session_state") pushed.push(JSON.parse(JSON.stringify(args.p_payload)));
  return Promise.resolve({ data: {}, error: null });
};

function hostCopy(coHosts: number) {
  const s = graphFromScorerSession(server(false));
  s.syncedAt = 1;
  s.lastReplicatedAt = 1;
  s.coHostCount = coHosts;
  saveLocalSession(s);
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
  pushed = [];
  pullFails = false;
});

describe("pushing a session that has co-hosts", () => {
  it("pulls first, and the push carries the co-host's score", async () => {
    hostCopy(1);
    await replicateSession(SID);
    expect(calls.slice(0, 2)).toEqual(["get_scorer_session", "sync_session_state"]);
    expect(pushed[0].matches[0].score_a).toBe(15);
    expect(getLocalSession(SID)!.matches[0].score_a).toBe(15);
  });

  it("still pushes when the pull fails", async () => {
    hostCopy(1);
    pullFails = true;
    await replicateSession(SID);
    expect(pushed.length).toBe(1);
    expect(pushed[0].matches[0].score_a).toBeNull();
  });

  it("does not pull at all for a session with no co-hosts", async () => {
    hostCopy(0);
    await replicateSession(SID);
    expect(calls).toEqual(["sync_session_state"]);
  });

  it("sends the rounds the host deleted, by name", async () => {
    hostCopy(0);
    const s = getLocalSession(SID)!;
    s.discardedRoundIds = ["gone-1"];
    saveLocalSession(s);
    await replicateSession(SID);
    expect(pushed[0].discarded_round_ids).toEqual(["gone-1"]);
  });
});
