import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The phone learning that the server ended (or reopened) a night — 0072.
 */

vi.mock("../../supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => (globalThis as any).__fakeRpc(name, args),
    from: (table: string) => ({
      select: (cols: string) => ({
        in: (_col: string, ids: string[]) => Promise.resolve((globalThis as any).__fakeSelect(table, cols, ids)),
      }),
    }),
  },
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

import { saveLocalSession, getLocalSession, LocalSession } from "../localSession";
import { reconcileSessionStatus, IDLE_MS } from "../sessionStatusCheck";

const H = 60 * 60 * 1000;
let rows: Record<string, any>;
let rpcCalls: string[];
let oldSchema: boolean;

(globalThis as any).__fakeSelect = (_t: string, cols: string, ids: string[]) => {
  if (oldSchema && cols.includes("reopened_at")) return { data: null, error: { message: "column sessions.reopened_at does not exist" } };
  return { data: ids.map((id) => rows[id]).filter(Boolean), error: null };
};
(globalThis as any).__fakeRpc = (name: string, args: any) => {
  rpcCalls.push(name);
  if (name === "end_session_if_idle") {
    rows[args.p_session_id].status = "ended";
    return Promise.resolve({ data: "ended", error: null });
  }
  return Promise.resolve({ data: null, error: null });
};

function local(id: string, opts: { status?: "live" | "ended"; synced?: boolean; lastChangeAgo?: number; endedAt?: string | null } = {}): LocalSession {
  const s: LocalSession = {
    session: {
      id, club_id: null, name: "Night", format: "mexicano", scoring_format: "fixed_21", ranking_basis: "points_first",
      status: opts.status ?? "live", join_code: "", public_token: "", scheduling_seed: 1, min_players_per_court: 4,
      team_score_mode: null, fixed_partner_style: null, counts_for_league: true,
      created_at: new Date(Date.now() - 20 * H).toISOString(), started_at: new Date(Date.now() - 20 * H).toISOString(),
      ended_at: opts.endedAt ?? null,
    },
    courts: [], players: [], pairs: [], rounds: [], matches: [], participants: [], rests: [],
    syncedAt: opts.synced === false ? null : 1,
    lastReplicatedAt: 1,
    lastError: null,
  };
  saveLocalSession(s);
  // saveLocalSession stamps changedAt = now; set the age we want, as pushed.
  const raw = JSON.parse(localStorage.getItem("padelier:localSessions:v1")!);
  raw[id].changedAt = Date.now() - (opts.lastChangeAgo ?? 0);
  raw[id].pushedChangedAt = raw[id].changedAt;
  localStorage.setItem("padelier:localSessions:v1", JSON.stringify(raw));
  return s;
}

beforeEach(() => {
  localStorage.clear();
  rows = {};
  rpcCalls = [];
  oldSchema = false;
});

describe("the server ended it", () => {
  it("a night the server auto-ended is ended on the phone, with the server's end time", async () => {
    const endedAt = new Date(Date.now() - 13 * H).toISOString();
    local("s1", { lastChangeAgo: 14 * H });
    rows.s1 = { id: "s1", status: "ended", ended_at: endedAt, reopened_at: null, last_activity_at: endedAt };
    expect(await reconcileSessionStatus()).toEqual(["s1"]);
    expect(getLocalSession("s1")!.session.status).toBe("ended");
    expect(getLocalSession("s1")!.session.ended_at).toBe(endedAt);
  });

  it("still works before 0072 is applied (no reopened_at column)", async () => {
    oldSchema = true;
    local("s1");
    rows.s1 = { id: "s1", status: "ended", ended_at: "2026-10-11T00:00:00Z" };
    expect(await reconcileSessionStatus()).toEqual(["s1"]);
  });

  it("a live night stays live", async () => {
    local("s1", { lastChangeAgo: 1 * H });
    rows.s1 = { id: "s1", status: "live", ended_at: null, reopened_at: null, last_activity_at: new Date(Date.now() - H).toISOString() };
    expect(await reconcileSessionStatus()).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });
});

describe("idle, and cron hasn't run", () => {
  it("asks the server to end it, and follows", async () => {
    local("s1", { lastChangeAgo: 13 * H });
    rows.s1 = { id: "s1", status: "live", ended_at: null, reopened_at: null, last_activity_at: new Date(Date.now() - 13 * H).toISOString() };
    expect(await reconcileSessionStatus()).toEqual(["s1"]);
    expect(rpcCalls.filter((n) => n !== "get_scorer_session")).toEqual(["end_session_if_idle"]);
    expect(getLocalSession("s1")!.session.status).toBe("ended");
  });

  it("does NOT when this phone has scores the server hasn't got yet", async () => {
    local("s1", { lastChangeAgo: 13 * H });
    const raw = JSON.parse(localStorage.getItem("padelier:localSessions:v1")!);
    raw.s1.pushedChangedAt = raw.s1.changedAt - 1; // unpushed
    localStorage.setItem("padelier:localSessions:v1", JSON.stringify(raw));
    rows.s1 = { id: "s1", status: "live", ended_at: null, reopened_at: null, last_activity_at: new Date(Date.now() - 13 * H).toISOString() };
    expect(await reconcileSessionStatus()).toEqual([]);
    expect(getLocalSession("s1")!.session.status).toBe("live");
  });

  it("a never-synced night idle 12 h is ended on the phone", async () => {
    local("s1", { synced: false, lastChangeAgo: IDLE_MS + H });
    expect(await reconcileSessionStatus()).toEqual(["s1"]);
    expect(getLocalSession("s1")!.session.status).toBe("ended");
  });

  it("a never-synced night played an hour ago is left alone", async () => {
    local("s1", { synced: false, lastChangeAgo: H });
    expect(await reconcileSessionStatus()).toEqual([]);
  });
});

describe("reopened", () => {
  it("a night reopened after this phone ended it goes live again", async () => {
    local("s1", { status: "ended", endedAt: new Date(Date.now() - 5 * H).toISOString() });
    rows.s1 = { id: "s1", status: "live", ended_at: null, reopened_at: new Date(Date.now() - H).toISOString(), last_activity_at: new Date().toISOString() };
    expect(await reconcileSessionStatus()).toEqual(["s1"]);
    expect(getLocalSession("s1")!.session.status).toBe("live");
  });

  it("but an ended night is NOT revived just because the server lags behind", async () => {
    local("s1", { status: "ended", endedAt: new Date(Date.now() - H).toISOString() });
    rows.s1 = { id: "s1", status: "live", ended_at: null, reopened_at: null, last_activity_at: new Date().toISOString() };
    expect(await reconcileSessionStatus()).toEqual([]);
    expect(getLocalSession("s1")!.session.status).toBe("ended");
  });
});
