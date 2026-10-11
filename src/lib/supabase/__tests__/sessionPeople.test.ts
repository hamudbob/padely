import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Who has joined a session — the data behind the end-of-session check and
 * the faces on the Standings tab.
 *
 * The case that matters most is the one with no network: a session running
 * on the host's phone, where club membership cannot be known. It must come
 * back as unknown (no "not in the club" list at all), never as "nobody is a
 * member", which would tell the host to chase the whole room.
 */

vi.mock("../client", () => ({ supabase: { from: () => { throw new Error("offline"); } } }));
vi.mock("../profileQueries", () => ({ getProfiles: async () => new Map() }));

import { getSessionPeople, unlinkedPlayers, nonMembers, SessionPeople } from "../sessionPeopleQueries";
import { saveLocalSession, getLocalSession, setLocalPlayerLink } from "../../offline/localSession";
import type { LocalSession } from "../../offline/localSession";

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
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });

function seed() {
  saveLocalSession({
    session: { id: "s1", status: "live", name: "Tue", club_id: "club-1", created_at: "2026-10-01T00:00:00Z" },
    courts: [],
    players: [
      { id: "p1", session_id: "s1", display_name: "Rafid", linked_user_id: "u1", status: "active" },
      { id: "p2", session_id: "s1", display_name: "Zidane", linked_user_id: null, status: "active" },
      { id: "p3", session_id: "s1", display_name: "Abiyan", linked_user_id: null, status: "active" },
      { id: "p4", session_id: "s1", display_name: "Gone", linked_user_id: null, status: "left" },
    ],
    pairs: [],
    rounds: [],
    matches: [],
    participants: [],
    rests: [],
    syncedAt: null,
    lastReplicatedAt: null,
    lastError: null,
  } as unknown as LocalSession);
}

beforeEach(() => {
  mem.clear();
  seed();
});

describe("offline, from this phone's copy", () => {
  it("lists who has no account, by name, leaving out players who left", async () => {
    const people = await getSessionPeople("s1");
    expect(unlinkedPlayers(people).map((p) => p.name)).toEqual(["Abiyan", "Zidane"]);
  });

  it("reports club membership as unknown, not as 'nobody is a member'", async () => {
    const people = await getSessionPeople("s1");
    expect(people.clubMemberIds).toBeNull();
    expect(nonMembers(people).length).toBe(0);
  });
});

describe("not in the club", () => {
  it("names linked players who aren't members, and only them", () => {
    const people: SessionPeople = {
      clubId: "club-1",
      pairPlayers: new Map(),
      clubMemberIds: new Set(["u1"]),
      byPlayer: new Map([
        ["p1", { playerId: "p1", name: "Rafid", userId: "u1", avatarUrl: null, status: "active" }],
        ["p5", { playerId: "p5", name: "Said", userId: "u5", avatarUrl: null, status: "active" }],
        ["p2", { playerId: "p2", name: "Zidane", userId: null, avatarUrl: null, status: "active" }],
      ]),
    };
    expect(nonMembers(people).map((p) => p.name)).toEqual(["Said"]);
  });
});

describe("a claim accepted on the host's phone", () => {
  it("links the spot and takes the real name on this device", () => {
    expect(setLocalPlayerLink("p2", "u2", "Zidane Basalamah")).toBe(true);
    const p = getLocalSession("s1")!.players.find((x) => x.id === "p2")!;
    expect(p.linked_user_id).toBe("u2");
    expect(p.display_name).toBe("Zidane Basalamah");
  });

  it("drops off the 'hasn't joined' list", async () => {
    setLocalPlayerLink("p2", "u2", "Zidane Basalamah");
    const people = await getSessionPeople("s1");
    expect(unlinkedPlayers(people).map((p) => p.name)).toEqual(["Abiyan"]);
  });

  it("reports false for a player this device does not hold", () => {
    expect(setLocalPlayerLink("nobody", "u9", "X")).toBe(false);
  });
});
