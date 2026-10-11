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

import { mergeScorerState, graphFromScorerSession, appendPayload, ScorerSession } from "../coHostMerge";
import { getLocalSession, saveLocalSession, LocalSession, noteDiscardedRound } from "../localSession";
import { generateNextRound } from "../../supabase/roundActions";

/**
 * The host phone folding a co-host's work into its own copy, and the co-host
 * drawing a round through the host's own generator.
 *
 * Fixture: a live Mexicano, 8 players, 2 courts, round 1 drawn.
 */

const SID = "5e550000-0000-0000-0000-000000000001";
const R1 = "r0000000-0000-0000-0000-000000000001";
const C1 = "c0000000-0000-0000-0000-000000000001";
const C2 = "c0000000-0000-0000-0000-000000000002";
const M1 = "m0000000-0000-0000-0000-000000000001";
const M2 = "m0000000-0000-0000-0000-000000000002";
const P = ["a", "b", "c", "d", "e", "f", "g", "h"].map((x) => `p000000${x}-0000-0000-0000-000000000000`);

function server(): ScorerSession {
  return {
    session: {
      id: SID, name: "Co-host Night", format: "mexicano", scoring_format: "fixed_21",
      ranking_basis: "points_first", fixed_partner_style: null, team_score_mode: null,
      min_players_per_court: 4, scheduling_seed: 42, status: "live", club_id: null,
      started_at: "2026-10-11T12:00:00Z", host_name: "Hamud", is_host: false,
    },
    courts: [
      { id: C1, ordinal: 1, display_name: "Court 1", available: true },
      { id: C2, ordinal: 2, display_name: "Court 2", available: true },
    ],
    players: P.map((id, i) => ({
      id, display_name: `P${i}`, gender: "M", status: "active" as const, team_side: null,
      preferred_side: null, matches_played: 0, rests: 0,
      joined_at: `2026-10-11T12:00:0${i}Z`, linked_user_id: null, avatar_url: null,
    })),
    pairs: [],
    rounds: [{ id: R1, sequence: 1, status: "in_progress", generation_reason: "initial", seed_used: 43,
               generated_at: "2026-10-11T12:00:00Z", added_by_scorer: null }],
    round_rests: [],
    adjustments: [],
    matches: [
      { id: M1, round_id: R1, court_id: C1, pair_a_id: null, pair_b_id: null, status: "not_started",
        outcome: null, score_a: null, score_b: null, scored_at: null,
        participants: [{ player_id: P[0], side: "A" }, { player_id: P[1], side: "A" },
                       { player_id: P[2], side: "B" }, { player_id: P[3], side: "B" }] },
      { id: M2, round_id: R1, court_id: C2, pair_a_id: null, pair_b_id: null, status: "not_started",
        outcome: null, score_a: null, score_b: null, scored_at: null,
        participants: [{ player_id: P[4], side: "A" }, { player_id: P[5], side: "A" },
                       { player_id: P[6], side: "B" }, { player_id: P[7], side: "B" }] },
    ],
  };
}

/** The host phone's copy of the same night. */
function phone(): LocalSession {
  const g = graphFromScorerSession(server());
  g.syncedAt = 1;
  return g;
}

function score(s: ScorerSession, matchId: string, a: number, b: number, at: string | null) {
  const m = s.matches.find((x) => x.id === matchId)!;
  m.score_a = a; m.score_b = b; m.status = "final";
  m.outcome = a > b ? "win_a" : b > a ? "win_b" : "draw";
  m.scored_at = at;
}

beforeEach(() => localStorage.clear());

describe("scores", () => {
  it("a co-host's score fills a match the phone has not scored", () => {
    const local = phone();
    const srv = server();
    score(srv, M1, 15, 6, "2026-10-11T12:20:00Z");
    const r = mergeScorerState(local, srv);
    expect(r).toEqual({ scores: 1, rounds: 0 });
    const m = local.matches.find((x) => x.id === M1)!;
    expect([m.score_a, m.score_b, m.status, m.outcome]).toEqual([15, 6, "final", "win_a"]);
    expect(local.rounds[0].status).toBe("in_progress"); // Court 2 still open
    expect(local.players.find((p) => p.id === P[0])!.matches_played).toBe(1);
  });

  it("the round is scored once the co-host finishes it", () => {
    const local = phone();
    const srv = server();
    score(srv, M1, 15, 6, "2026-10-11T12:20:00Z");
    score(srv, M2, 10, 11, "2026-10-11T12:21:00Z");
    mergeScorerState(local, srv);
    expect(local.rounds[0].status).toBe("scored");
  });

  it("a LATER co-host correction replaces the phone's score", () => {
    const local = phone();
    Object.assign(local.matches[0], { score_a: 10, score_b: 11, status: "final", outcome: "win_b", scored_at: "2026-10-11T12:20:00Z" });
    const srv = server();
    score(srv, M1, 15, 6, "2026-10-11T12:25:00Z");
    expect(mergeScorerState(local, srv).scores).toBe(1);
    expect(local.matches[0].score_a).toBe(15);
  });

  it("an EARLIER server score does not replace the phone's newer one", () => {
    const local = phone();
    Object.assign(local.matches[0], { score_a: 10, score_b: 11, status: "final", outcome: "win_b", scored_at: "2026-10-11T12:30:00Z" });
    const srv = server();
    score(srv, M1, 15, 6, "2026-10-11T12:25:00Z");
    expect(mergeScorerState(local, srv).scores).toBe(0);
    expect(local.matches[0].score_a).toBe(10);
  });

  it("a server score with no timestamp never replaces one the phone has", () => {
    const local = phone();
    Object.assign(local.matches[0], { score_a: 10, score_b: 11, status: "final", outcome: "win_b", scored_at: null });
    const srv = server();
    score(srv, M1, 15, 6, null);
    expect(mergeScorerState(local, srv).scores).toBe(0);
  });

  it("a cancelled match stays cancelled", () => {
    const local = phone();
    local.matches[0].status = "cancelled";
    const srv = server();
    score(srv, M1, 15, 6, "2026-10-11T12:25:00Z");
    expect(mergeScorerState(local, srv).scores).toBe(0);
  });

  it("merging the same state twice changes nothing the second time", () => {
    const local = phone();
    const srv = server();
    score(srv, M1, 15, 6, "2026-10-11T12:20:00Z");
    mergeScorerState(local, srv);
    const before = JSON.stringify(local);
    expect(mergeScorerState(local, srv)).toEqual({ scores: 0, rounds: 0 });
    expect(JSON.stringify(local)).toBe(before);
  });
});

/** Round 1 scored on the server, then a co-host round 2 built from the real generator. */
async function serverWithCoHostRound2(): Promise<{ srv: ScorerSession; payload: Record<string, any> }> {
  const srv = server();
  score(srv, M1, 15, 6, "2026-10-11T12:20:00Z");
  score(srv, M2, 10, 11, "2026-10-11T12:21:00Z");
  const graph = graphFromScorerSession(srv);
  const res = await generateNextRound(SID, undefined, false, { graph, dryRun: true });
  const payload = appendPayload(graph, res.roundId) as Record<string, any>;
  // What append_round_as_scorer then stores.
  srv.rounds[0].status = "scored";
  srv.rounds.push({ id: payload.id, sequence: payload.sequence, status: "in_progress",
                    generation_reason: payload.generation_reason, seed_used: payload.seed_used,
                    generated_at: "2026-10-11T12:22:00Z", added_by_scorer: "co-host" });
  for (const m of payload.matches) {
    srv.matches.push({ id: m.id, round_id: payload.id, court_id: m.court_id, pair_a_id: m.pair_a_id,
                       pair_b_id: m.pair_b_id, status: "not_started", outcome: null, score_a: null,
                       score_b: null, scored_at: null, participants: m.participants });
  }
  for (const r of payload.rests) srv.round_rests.push({ round_id: payload.id, ...r });
  return { srv, payload };
}

describe("the co-host's next round", () => {
  it("is drawn without touching the co-host's phone storage", async () => {
    const { payload } = await serverWithCoHostRound2();
    expect(payload.sequence).toBe(2);
    expect(payload.matches.length).toBe(2);
    const seated = payload.matches.flatMap((m: any) => m.participants.map((p: any) => p.player_id));
    expect(new Set(seated).size).toBe(8);
    expect(new Set(payload.matches.map((m: any) => m.court_id)).size).toBe(2);
    expect(getLocalSession(SID)).toBeNull();
  });

  it("is the SAME round the host's phone would have drawn", async () => {
    const { payload } = await serverWithCoHostRound2();

    const hostCopy = phone();
    const srv = server();
    score(srv, M1, 15, 6, "2026-10-11T12:20:00Z");
    score(srv, M2, 10, 11, "2026-10-11T12:21:00Z");
    mergeScorerState(hostCopy, srv);
    saveLocalSession(hostCopy);
    const res = await generateNextRound(SID);
    const host = getLocalSession(SID)!;
    const lineup = (matches: { court_id: string; ids: string[] }[]) =>
      matches.map((m) => `${m.court_id}:${m.ids.slice().sort().join(",")}`).sort();
    const hostLineup = lineup(host.matches.filter((m) => m.round_id === res.roundId).map((m) => ({
      court_id: m.court_id,
      ids: host.participants.filter((p) => p.match_id === m.id).map((p) => `${p.side}${p.player_id}`),
    })));
    const coLineup = lineup(payload.matches.map((m: any) => ({
      court_id: m.court_id, ids: m.participants.map((p: any) => `${p.side}${p.player_id}`),
    })));
    expect(coLineup).toEqual(hostLineup);
  });

  it("lands on the host's phone with its matches, lineups and rests", async () => {
    const { srv, payload } = await serverWithCoHostRound2();
    const local = phone();
    const r = mergeScorerState(local, srv);
    expect(r).toEqual({ scores: 2, rounds: 1 });
    expect(local.rounds.map((x) => [x.sequence, x.status])).toEqual([[1, "scored"], [2, "in_progress"]]);
    expect(local.matches.filter((m) => m.round_id === payload.id).length).toBe(2);
    const ids = new Set(local.matches.filter((m) => m.round_id === payload.id).map((m) => m.id));
    expect(local.participants.filter((p) => ids.has(p.match_id)).length).toBe(8);
  });

  it("the host can then advance from it on the phone", async () => {
    const { srv, payload } = await serverWithCoHostRound2();
    for (const m of srv.matches.filter((x) => x.round_id === payload.id)) score(srv, m.id, 12, 9, "2026-10-11T12:40:00Z");
    const local = phone();
    mergeScorerState(local, srv);
    saveLocalSession(local);
    const res = await generateNextRound(SID);
    expect(res.sequence).toBe(3);
  });

  it("a round the host deleted on purpose is not pulled back", async () => {
    const { srv, payload } = await serverWithCoHostRound2();
    const local = phone();
    noteDiscardedRound(local, payload.id);
    expect(mergeScorerState(local, srv).rounds).toBe(0);
  });

  it("the host's own round at the same sequence wins", async () => {
    const { srv } = await serverWithCoHostRound2();
    const local = phone();
    local.rounds.push({ id: "host-r2", session_id: SID, sequence: 2, status: "in_progress",
                        generation_reason: "host", seed_used: 44, generated_at: "2026-10-11T12:22:00Z" });
    expect(mergeScorerState(local, srv).rounds).toBe(0);
    expect(local.rounds.filter((r) => r.sequence === 2).map((r) => r.id)).toEqual(["host-r2"]);
  });

  it("never pulls a round that would leave a gap", async () => {
    const { srv } = await serverWithCoHostRound2();
    srv.rounds[1].sequence = 3;
    const local = phone();
    expect(mergeScorerState(local, srv).rounds).toBe(0);
  });
});
