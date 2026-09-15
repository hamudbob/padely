import { describe, it, expect, beforeEach } from "vitest";
import { swapLocalRoundPlayers, getLocalSession, saveLocalSession } from "../localSession";
import type { LocalSession } from "../localSession";

/**
 * The owner-only lineup swap, on a device-held session.
 *
 * This mirrors swap_round_players (0033) exactly, and it has to: the RPC still
 * runs for a session the device does NOT hold, so the two implementations sit
 * either side of the same button. If they disagree, the same tap produces a
 * different lineup depending on which phone made the session.
 *
 * The bug these were written for: the chips rendered, the host tapped two
 * players, and nothing moved — because the only code path was the RPC, and a
 * local-first session has nothing on the server worth swapping.
 */

/**
 * vitest runs in the "node" environment here (vite.config.ts), so there is no
 * localStorage. readAll() swallows the ReferenceError and returns {}, but
 * writeAll() throws — so without this shim every test fails on save rather than
 * on the thing it is testing. An in-memory Map is enough: the module only ever
 * does getItem/setItem/clear on one key.
 */
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

const ROUND = "round-1";

/** Two courts, four players on court, two resting. */
function seed(): LocalSession {
  const s = {
    session: {
      id: "sess-1",
      status: "live",
      scoring_format: "fixed_21",
      ranking_basis: "points_first",
      format: "mexicano",
      started_at: new Date().toISOString(),
    },
    courts: [],
    players: ["ana", "bob", "cat", "dan", "eve", "fay"].map((id) => ({ id, display_name: id })),
    pairs: [],
    rounds: [{ id: ROUND, session_id: "sess-1", sequence: 1, status: "in_progress" }],
    matches: [
      { id: "m1", round_id: ROUND, court_id: "c1", status: "not_started", score_a: null, score_b: null },
      { id: "m2", round_id: ROUND, court_id: "c2", status: "not_started", score_a: null, score_b: null },
    ],
    participants: [
      { match_id: "m1", player_id: "ana", side: "A" },
      { match_id: "m1", player_id: "bob", side: "B" },
      { match_id: "m2", player_id: "cat", side: "A" },
      { match_id: "m2", player_id: "dan", side: "B" },
    ],
    rests: [
      { round_id: ROUND, player_id: "eve", consecutive_rest_count: 0 },
      { round_id: ROUND, player_id: "fay", consecutive_rest_count: 1 },
    ],
    syncedAt: null,
    lastReplicatedAt: null,
  } as unknown as LocalSession;
  saveLocalSession(s);
  return s;
}

const slotOf = (id: string) => {
  const s = getLocalSession("sess-1")!;
  const p = s.participants.find((mp) => mp.player_id === id);
  return p ? `${p.match_id}${p.side}` : null;
};
const isResting = (id: string) =>
  getLocalSession("sess-1")!.rests.some((r) => r.round_id === ROUND && r.player_id === id);
const onCourtCount = () => getLocalSession("sess-1")!.participants.length;

beforeEach(() => {
  localStorage.clear();
  seed();
});

describe("two players on court", () => {
  it("exchanges their exact match and side", () => {
    expect(slotOf("ana")).toBe("m1A");
    expect(slotOf("dan")).toBe("m2B");

    expect(swapLocalRoundPlayers(ROUND, "ana", "dan")).toBe("ok");

    expect(slotOf("ana")).toBe("m2B");
    expect(slotOf("dan")).toBe("m1A");
  });

  it("swapping within one match flips only the sides", () => {
    expect(swapLocalRoundPlayers(ROUND, "ana", "bob")).toBe("ok");
    expect(slotOf("ana")).toBe("m1B");
    expect(slotOf("bob")).toBe("m1A");
  });

  it("never loses or duplicates a seat", () => {
    swapLocalRoundPlayers(ROUND, "ana", "dan");
    expect(onCourtCount()).toBe(4);
    const seats = getLocalSession("sess-1")!.participants.map((p) => `${p.match_id}${p.side}`);
    expect(new Set(seats).size).toBe(4);
  });

  it("is its own inverse", () => {
    swapLocalRoundPlayers(ROUND, "ana", "dan");
    swapLocalRoundPlayers(ROUND, "ana", "dan");
    expect(slotOf("ana")).toBe("m1A");
    expect(slotOf("dan")).toBe("m2B");
  });
});

describe("pulling a rester on", () => {
  it("gives the rester the slot and sits the other player down", () => {
    expect(swapLocalRoundPlayers(ROUND, "ana", "eve")).toBe("ok");

    expect(slotOf("eve")).toBe("m1A");
    expect(slotOf("ana")).toBe(null);
    expect(isResting("ana")).toBe(true);
    expect(isResting("eve")).toBe(false);
    expect(onCourtCount()).toBe(4);
  });

  it("works in either argument order", () => {
    expect(swapLocalRoundPlayers(ROUND, "fay", "dan")).toBe("ok");
    expect(slotOf("fay")).toBe("m2B");
    expect(isResting("dan")).toBe(true);
    expect(isResting("fay")).toBe(false);
  });
});

describe("the cases that must do nothing", () => {
  it("two resters is a no-op", () => {
    expect(swapLocalRoundPlayers(ROUND, "eve", "fay")).toBe("ok");
    expect(isResting("eve")).toBe(true);
    expect(isResting("fay")).toBe(true);
    expect(onCourtCount()).toBe(4);
  });

  it("a player with themselves is a no-op", () => {
    expect(swapLocalRoundPlayers(ROUND, "ana", "ana")).toBe("ok");
    expect(slotOf("ana")).toBe("m1A");
  });

  it("reports not-local for a round this device does not hold", () => {
    expect(swapLocalRoundPlayers("someone-elses-round", "ana", "dan")).toBe("not-local");
  });
});

describe("locking, same rule as the RPC", () => {
  it("refuses once any match in the session is final", () => {
    const s = getLocalSession("sess-1")!;
    s.matches[1].status = "final";
    s.matches[1].score_a = 21;
    s.matches[1].score_b = 0;
    saveLocalSession(s);

    expect(swapLocalRoundPlayers(ROUND, "ana", "eve")).toBe("locked");
    // and nothing moved
    expect(slotOf("ana")).toBe("m1A");
    expect(isResting("eve")).toBe(true);
  });

  it("locks a DIFFERENT round's lineup too, because the rule is session-wide", () => {
    const s = getLocalSession("sess-1")!;
    s.rounds.push({ id: "round-2", session_id: "sess-1", sequence: 2, status: "in_progress" } as never);
    s.matches[0].status = "final";
    saveLocalSession(s);

    expect(swapLocalRoundPlayers(ROUND, "cat", "dan")).toBe("locked");
  });
});
