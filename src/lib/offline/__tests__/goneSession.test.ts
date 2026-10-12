import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A session deleted on the server after this phone uploaded it. The push is
 * refused forever with "That session does not exist here yet." — and the
 * phone used to retry every minute (82 errors in a week from one browser).
 */

vi.mock("../../supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => (globalThis as any).__fakeRpc(name, args) },
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
const g = globalThis as any;
g.window = g;
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.document = { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} };

import { saveLocalSession, getLocalSession, LocalSession } from "../localSession";
import { replicateSession } from "../localSessionSync";

let calls = 0;
let reply: { data: unknown; error: unknown };
g.__fakeRpc = (name: string) => {
  if (name !== "sync_session_state") return Promise.resolve({ data: null, error: { message: "That session does not exist here yet." } });
  calls++;
  return Promise.resolve(reply);
};

function session(id: string): LocalSession {
  return {
    session: {
      id, club_id: null, name: "Night", format: "mexicano", scoring_format: "fixed_21", ranking_basis: "points_first",
      status: "live", join_code: "", public_token: "", scheduling_seed: 1, min_players_per_court: 4,
      team_score_mode: null, fixed_partner_style: null, counts_for_league: true,
      created_at: new Date().toISOString(), started_at: new Date().toISOString(), ended_at: null,
    },
    courts: [], players: [], pairs: [], rounds: [], matches: [], participants: [], rests: [],
    syncedAt: 1, lastReplicatedAt: 1, lastError: null,
  };
}

beforeEach(() => {
  localStorage.clear();
  calls = 0;
});

describe("a session the server no longer has", () => {
  it("is set aside after one refusal, and not retried", async () => {
    saveLocalSession(session("gone"));
    reply = { data: null, error: { code: "P0001", message: "That session does not exist here yet." } };
    await replicateSession("gone");
    expect(getLocalSession("gone")).toBeNull();
    const aside = JSON.parse(localStorage.getItem("padelier:sessionsGoneFromServer:v1")!);
    expect(aside.gone.session.session.id).toBe("gone");
    await replicateSession("gone");
    expect(calls).toBe(1);
  });

  it("any other failure keeps the session and records the error, as before", async () => {
    saveLocalSession(session("kept"));
    reply = { data: null, error: { code: "P0001", message: "That session belongs to someone else." } };
    await replicateSession("kept");
    expect(getLocalSession("kept")!.lastError).toBe("That session belongs to someone else.");
  });
});
