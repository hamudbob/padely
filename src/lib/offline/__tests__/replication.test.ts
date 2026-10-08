import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Keeping the server current with a session this phone is running.
 *
 * Three ways this used to go wrong, each written as a test that fails on the
 * old code:
 *
 *  1. A LOOP. Every write to local storage announced every stored session as
 *     changed — including the write that records "the server accepted it".
 *     So each successful push scheduled the next one, 1.5 s later, forever,
 *     for every session on the phone, ended ones included. A phone with the
 *     app open was re-uploading whole evenings around forty times a minute.
 *
 *  2. A DROP. A change made while a push was already in flight was ignored.
 *     The loop above happened to paper over this; fixing the loop exposes it.
 *
 *  3. A SWEEP. Ended sessions are deleted from the phone a day after their
 *     last successful push — even when they still held changes the server
 *     never received.
 */

vi.mock("../../supabase/client", () => ({
  supabase: { rpc: (name: string, args: unknown) => (globalThis as any).__fakeRpc(name, args) },
}));
vi.mock("../../supabase/scoreSyncQueue", () => ({ flush: async () => {} }));
vi.mock("../../supabase/ratingActions", () => ({ applySessionRatings: async () => {} }));
vi.mock("../../supabase/resultActions", () => ({ applySessionResults: async () => {} }));

import { saveLocalSession, getLocalSession, forgetSyncedSessions, setLocalCourtName } from "../localSession";
import type { LocalSession } from "../localSession";
import { startLocalSessionSync } from "../localSessionSync";

/* ── A browser, minimally ─────────────────────────────────────────────── */

const mem = new Map<string, string>();
const g = globalThis as any;
g.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};
g.window = g;
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.document = { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} };

/* ── A server we can watch ────────────────────────────────────────────── */

type Push = { sessionId: string; payload: any };
let pushes: Push[];
let failNext = 0;
let alwaysFail = false;
let latencyMs = 0;

g.__fakeRpc = (name: string, args: { p_payload: any }) => {
  if (name !== "sync_session_state") return Promise.resolve({ data: {}, error: null });
  const payload = JSON.parse(JSON.stringify(args.p_payload));
  const answer = () => {
    if (alwaysFail || failNext > 0) {
      failNext = Math.max(0, failNext - 1);
      return { data: null, error: new Error("network down") };
    }
    pushes.push({ sessionId: payload.session.id, payload });
    return { data: {}, error: null };
  };
  if (latencyMs === 0) return Promise.resolve(answer());
  return new Promise((r) => setTimeout(() => r(answer()), latencyMs));
};

function session(id: string, status: "live" | "ended" = "live"): LocalSession {
  return {
    session: { id, status, name: "Tuesday", created_at: new Date(Date.now()).toISOString() },
    courts: [],
    players: [],
    pairs: [],
    rounds: [],
    rests: [],
    participants: [],
    matches: [{ id: `${id}-m1`, round_id: "r1", court_id: "c1", score_a: null, score_b: null, status: "not_started" }],
    syncedAt: Date.now(),
    lastReplicatedAt: Date.now(),
    lastError: null,
  } as unknown as LocalSession;
}

function score(id: string, a: number | null, b: number | null) {
  const s = getLocalSession(id)!;
  (s.matches[0] as any).score_a = a;
  (s.matches[0] as any).score_b = b;
  saveLocalSession(s);
}

let stop: () => void = () => {};

beforeEach(async () => {
  vi.useFakeTimers();
  mem.clear();
  pushes = [];
  failNext = 0;
  alwaysFail = false;
  latencyMs = 0;
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

/** Start the syncer and let any start-up push settle, then forget it. */
async function startQuiet() {
  stop = startLocalSessionSync();
  await vi.advanceTimersByTimeAsync(10_000);
  pushes = [];
}

describe("one change, one push", () => {
  it("pushes a score once and then goes quiet", async () => {
    saveLocalSession(session("s1"));
    await startQuiet();

    score("s1", 21, 19);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pushes.length).toBe(1);
    expect(pushes[0].payload.matches[0].score_a).toBe(21);
  });

  it("does not re-push an ended session when a different session changes", async () => {
    saveLocalSession(session("ended", "ended"));
    saveLocalSession(session("live"));
    await startQuiet();

    score("live", 21, 10);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(pushes.filter((p) => p.sessionId === "ended").length).toBe(0);
    expect(pushes.filter((p) => p.sessionId === "live").length).toBe(1);
  });
});

describe("every kind of change is noticed", () => {
  it("a change made through a live action, not saveLocalSession, is pushed", async () => {
    const s = session("s7");
    (s as any).courts = [{ id: "s7-c1", session_id: "s7", ordinal: 1, display_name: "Court 1", available: true }];
    saveLocalSession(s);
    await startQuiet();

    setLocalCourtName("s7-c1", "Centre Court");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(pushes.length).toBe(1);
    expect(pushes[0].payload.courts[0].display_name).toBe("Centre Court");
  });

  it("saving an identical copy is not a change", async () => {
    saveLocalSession(session("s8"));
    await startQuiet();

    saveLocalSession(getLocalSession("s8")!);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(pushes.length).toBe(0);
  });
});

describe("nothing is lost", () => {
  it("a change made while a push is in flight still reaches the server", async () => {
    saveLocalSession(session("s3"));
    await startQuiet();
    latencyMs = 3_000;

    score("s3", 21, null); // push starts after the 1.5 s debounce
    await vi.advanceTimersByTimeAsync(1_600);
    score("s3", 21, 19); // ...and this lands while it is still on the wire

    await vi.advanceTimersByTimeAsync(60_000);

    const last = pushes[pushes.length - 1];
    expect(last.payload.matches[0].score_b).toBe(19);
    expect(pushes.length).toBeLessThanOrEqual(2);
  });

  it("a failed push is retried on its own, with no new change to prompt it", async () => {
    saveLocalSession(session("s4"));
    await startQuiet();
    failNext = 2;

    score("s4", 21, 19);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pushes.length).toBe(1);
    expect(pushes[0].payload.matches[0].score_b).toBe(19);
    expect(getLocalSession("s4")!.lastError).toBeNull();
  });

  it("keeps retrying while the network is down, without hammering it", async () => {
    saveLocalSession(session("s5"));
    await startQuiet();
    alwaysFail = true;
    let attempts = 0;
    const real = g.__fakeRpc;
    g.__fakeRpc = (n: string, a: any) => {
      if (n === "sync_session_state") attempts++;
      return real(n, a);
    };

    score("s5", 21, 19);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    g.__fakeRpc = real;

    // Backing off to a minute: ten minutes is a dozen or so tries, not 400.
    expect(attempts).toBeGreaterThanOrEqual(5);
    expect(attempts).toBeLessThanOrEqual(20);
    expect(getLocalSession("s5")!.lastError).not.toBeNull();
  });
});

describe("the 24-hour sweep", () => {
  it("never deletes a session holding changes the server has not taken", async () => {
    saveLocalSession(session("old", "ended"));
    await startQuiet();
    alwaysFail = true;

    score("old", 21, 19);
    await vi.advanceTimersByTimeAsync(5_000);

    // Pretend the last successful push was two days ago.
    const all = JSON.parse(mem.get("padelier:localSessions:v1")!);
    all.old.lastReplicatedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
    mem.set("padelier:localSessions:v1", JSON.stringify(all));

    forgetSyncedSessions();
    expect(getLocalSession("old")).not.toBeNull();
  });
});
