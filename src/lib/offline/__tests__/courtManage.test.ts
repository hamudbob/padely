import { describe, it, expect, beforeEach } from "vitest";
import { setLocalCourtName, setLocalCourtAvailability, getLocalSession, saveLocalSession } from "../localSession";
import type { LocalSession } from "../localSession";

/**
 * Court rename and availability, on a device-held session.
 *
 * Both were server-only. The rename never appeared, because the host's board
 * renders local.courts — and the next replication then pushed the stale local
 * name back over the server, so the change undid itself.
 *
 * Availability was the one that mattered: the next round is drawn from
 * `local.courts.filter((c) => c.available)` (roundActions.ts:118). A host could
 * close a court and the app would keep scheduling matches on it for the rest of
 * the evening, with nothing on screen to say the setting had not taken.
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

function seed(): void {
  saveLocalSession({
    session: {
      id: "sess-1",
      status: "live",
      scoring_format: "fixed_21",
      ranking_basis: "points_first",
      format: "mexicano",
      started_at: new Date().toISOString(),
    },
    courts: [
      { id: "c1", session_id: "sess-1", ordinal: 1, display_name: "Court 1", available: true },
      { id: "c2", session_id: "sess-1", ordinal: 2, display_name: "Court 2", available: true },
    ],
    players: [],
    pairs: [],
    rounds: [],
    matches: [],
    participants: [],
    rests: [],
    syncedAt: null,
    lastReplicatedAt: null,
  } as unknown as LocalSession);
}

const court = (id: string) => getLocalSession("sess-1")!.courts.find((c) => c.id === id)!;
/** Exactly what roundActions.ts:118 does when drawing the next round. */
const drawableCourts = () =>
  getLocalSession("sess-1")!
    .courts.filter((c) => c.available)
    .map((c) => c.id);

beforeEach(() => {
  localStorage.clear();
  seed();
});

describe("renaming a court", () => {
  it("changes the name the host's board reads", () => {
    expect(setLocalCourtName("c1", "Centre Court")).toBe(true);
    expect(court("c1").display_name).toBe("Centre Court");
  });

  it("leaves the other court alone", () => {
    setLocalCourtName("c1", "Centre Court");
    expect(court("c2").display_name).toBe("Court 2");
  });

  it("does not touch availability", () => {
    setLocalCourtName("c1", "Centre Court");
    expect(court("c1").available).toBe(true);
  });

  it("reports false for a court this device does not hold", () => {
    expect(setLocalCourtName("not-mine", "Nope")).toBe(false);
  });
});

describe("closing a court", () => {
  it("takes it out of the next round's draw", () => {
    expect(drawableCourts().length).toBe(2);
    expect(setLocalCourtAvailability("c1", false)).toBe(true);
    expect(drawableCourts()).toEqual(["c2"]);
  });

  it("reopening puts it back", () => {
    setLocalCourtAvailability("c1", false);
    setLocalCourtAvailability("c1", true);
    expect(drawableCourts().length).toBe(2);
  });

  it("does not touch the name", () => {
    setLocalCourtAvailability("c1", false);
    expect(court("c1").display_name).toBe("Court 1");
  });

  it("reports false for a court this device does not hold", () => {
    expect(setLocalCourtAvailability("not-mine", false)).toBe(false);
  });
});

describe("the two settings are independent", () => {
  it("survives a rename after a close", () => {
    setLocalCourtAvailability("c1", false);
    setLocalCourtName("c1", "Closed Court");
    expect(court("c1").available).toBe(false);
    expect(court("c1").display_name).toBe("Closed Court");
    expect(drawableCourts()).toEqual(["c2"]);
  });
});
