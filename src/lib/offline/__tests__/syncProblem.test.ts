import { describe, it, expect } from "vitest";
import { syncProblem, friendlyReason } from "../syncProblem";
import type { LocalSession } from "../localSession";

const NOW = Date.parse("2026-11-04T13:00:00Z");
const MIN = 60_000;

function s(over: Partial<LocalSession> & { createdAgo?: number }): LocalSession {
  const { createdAgo = 10 * MIN, ...rest } = over;
  return {
    session: { id: "s1", club_id: null, name: "Night", format: "mexicano", scoring_format: "fixed_21", ranking_basis: "points_first",
      status: "live", join_code: "", public_token: "", scheduling_seed: 1, min_players_per_court: 4, team_score_mode: null,
      fixed_partner_style: null, counts_for_league: true, created_at: new Date(NOW - createdAgo).toISOString(),
      started_at: new Date(NOW - createdAgo).toISOString(), ended_at: null },
    courts: [], players: [], pairs: [], rounds: [], matches: [], participants: [], rests: [],
    syncedAt: null, lastReplicatedAt: null, lastError: null, ...rest,
  } as LocalSession;
}

describe("syncProblem", () => {
  it("15 Oct 2026: refused all night → says so, with the reason in plain words", () => {
    const p = syncProblem(s({ lastError: "Could not find your team." }), NOW, true);
    expect(p).toEqual({ kind: "refused", neverUploaded: true, reason: "Could not find your team." });
    expect(friendlyReason("Could not find your team.")).toMatch(/isn't set up to host/);
  });

  it("a brand-new session uploading right now: quiet", () => {
    expect(syncProblem(s({ createdAgo: 20_000 }), NOW, true)).toBeNull();
  });

  it("never uploaded after 90 s with no error yet: still mentioned", () => {
    expect(syncProblem(s({ createdAgo: 5 * MIN }), NOW, true)?.kind).toBe("refused");
  });

  it("uploaded and up to date: quiet", () => {
    expect(syncProblem(s({ syncedAt: NOW - 30 * MIN, lastReplicatedAt: NOW - 10_000, changedAt: NOW - 20_000, pushedChangedAt: NOW - 20_000 }), NOW, true)).toBeNull();
  });

  it("changes owed for a few seconds: quiet; for minutes: mentioned", () => {
    const base = { syncedAt: NOW - 30 * MIN, changedAt: NOW - 5_000, pushedChangedAt: NOW - 60_000 };
    expect(syncProblem(s({ ...base, lastReplicatedAt: NOW - 60_000 }), NOW, true)).toBeNull();
    expect(syncProblem(s({ ...base, lastReplicatedAt: NOW - 6 * MIN }), NOW, true)).toEqual({ kind: "behind", minutes: 6 });
  });

  it("offline, or a network blip: quiet at first, then a calm 'no signal'", () => {
    expect(syncProblem(s({ createdAgo: 30_000 }), NOW, false)).toBeNull();
    expect(syncProblem(s({ createdAgo: 5 * MIN }), NOW, false)).toEqual({ kind: "offline", neverUploaded: true });
    expect(syncProblem(s({ createdAgo: 5 * MIN, lastError: "TypeError: Failed to fetch" }), NOW, true)?.kind).toBe("offline");
  });
});
