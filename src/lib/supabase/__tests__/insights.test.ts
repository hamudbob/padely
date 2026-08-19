import { describe, it, expect } from "vitest";
import { computeInsights, wilsonLower } from "../insightsQueries";

/**
 * The profile's maths, tested against a hand-built payload.
 *
 * computeInsights is a pure function of what get_my_participation returns, so
 * none of this needs a network or a database — which is the point of having
 * split it out from the fetch.
 *
 * The fixture below is small enough to reason about completely: two sessions,
 * one inside the 30-day window and one well outside it, and a partner and a
 * rival whose numbers are chosen so the ranking has to make a real decision.
 */

const ME = "11111111-1111-1111-1111-111111111111";
const RIZKY = "22222222-2222-2222-2222-222222222222";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

/** side "A" is always mine in this fixture, so the results read plainly. */
interface Spec {
  session: "recent" | "old";
  seq: number;
  /** my partner and the two opponents, by player id */
  partner: string;
  opponents: [string, string];
  outcome: "win_a" | "win_b" | "draw";
  scoreA: number;
  scoreB: number;
}

function build(specs: Spec[]) {
  const matches = specs.map((s, i) => ({
    id: `m${i}`,
    round_id: `r${i}`,
    outcome: s.outcome,
    status: "final",
    score_a: s.scoreA,
    score_b: s.scoreB,
  }));
  return {
    my_players: [
      { id: "me-recent", session_id: "s-recent" },
      { id: "me-old", session_id: "s-old" },
    ],
    my_participations: specs.map((s, i) => ({
      match_id: `m${i}`,
      player_id: s.session === "recent" ? "me-recent" : "me-old",
      side: "A" as const,
    })),
    matches,
    participants: specs.flatMap((s, i) => [
      { match_id: `m${i}`, player_id: s.session === "recent" ? "me-recent" : "me-old", side: "A" as const },
      { match_id: `m${i}`, player_id: s.partner, side: "A" as const },
      { match_id: `m${i}`, player_id: s.opponents[0], side: "B" as const },
      { match_id: `m${i}`, player_id: s.opponents[1], side: "B" as const },
    ]),
    rounds: specs.map((s, i) => ({
      id: `r${i}`,
      session_id: s.session === "recent" ? "s-recent" : "s-old",
      sequence: s.seq,
    })),
    // The old session ENDED 60 days ago; the recent one 3 days ago.
    sessions: [
      { id: "s-old", created_at: iso(61), ended_at: iso(60), format: "americano" },
      { id: "s-recent", created_at: iso(4), ended_at: iso(3), format: "mexicano" },
    ],
    people: [
      { id: "me-recent", display_name: "Me", linked_user_id: ME, avatar_url: null },
      { id: "me-old", display_name: "Me", linked_user_id: ME, avatar_url: null },
      { id: "rizky-1", display_name: "Rizky Pratama", linked_user_id: RIZKY, avatar_url: "https://cdn/r.png" },
      { id: "rizky-2", display_name: "Rizky Pratama", linked_user_id: RIZKY, avatar_url: "https://cdn/r.png" },
      { id: "dewi-1", display_name: "Dewi", linked_user_id: null, avatar_url: null },
      { id: "dewi-2", display_name: "dewi", linked_user_id: null, avatar_url: null },
      { id: "budi-1", display_name: "Budi", linked_user_id: null, avatar_url: null },
      { id: "budi-2", display_name: "Budi", linked_user_id: null, avatar_url: null },
    ],
  };
}

// Four games alongside Rizky (3 won), four alongside Dewi (1 won), and eight
// against Budi of which I lost six. Chronological order is old session first.
const SPECS: Spec[] = [
  // ── the old session, 60 days ago: W W L L ────────────────────────────
  { session: "old", seq: 1, partner: "rizky-2", opponents: ["budi-2", "dewi-2"], outcome: "win_a", scoreA: 21, scoreB: 10 },
  { session: "old", seq: 2, partner: "rizky-2", opponents: ["budi-2", "dewi-2"], outcome: "win_a", scoreA: 21, scoreB: 15 },
  { session: "old", seq: 3, partner: "dewi-2", opponents: ["budi-2", "rizky-2"], outcome: "win_b", scoreA: 12, scoreB: 21 },
  { session: "old", seq: 4, partner: "dewi-2", opponents: ["budi-2", "rizky-2"], outcome: "win_b", scoreA: 8, scoreB: 21 },
  // ── the recent session, 3 days ago: W L W L L ────────────────────────
  { session: "recent", seq: 1, partner: "rizky-1", opponents: ["budi-1", "dewi-1"], outcome: "win_a", scoreA: 21, scoreB: 19 },
  { session: "recent", seq: 2, partner: "rizky-1", opponents: ["budi-1", "dewi-1"], outcome: "win_b", scoreA: 14, scoreB: 21 },
  { session: "recent", seq: 3, partner: "dewi-1", opponents: ["budi-1", "rizky-1"], outcome: "win_a", scoreA: 21, scoreB: 11 },
  { session: "recent", seq: 4, partner: "dewi-1", opponents: ["budi-1", "rizky-1"], outcome: "win_b", scoreA: 17, scoreB: 21 },
];

const insights = computeInsights(build(SPECS));

describe("wilsonLower", () => {
  it("ranks a long good run above a short perfect one", () => {
    expect(wilsonLower(2, 2)).toBeCloseTo(0.342, 3);
    expect(wilsonLower(4, 4)).toBeCloseTo(0.51, 2);
    expect(wilsonLower(15, 20)).toBeCloseTo(0.531, 3);
    expect(wilsonLower(15, 20)).toBeGreaterThan(wilsonLower(2, 2));
    expect(wilsonLower(15, 20)).toBeGreaterThan(wilsonLower(4, 4));
  });

  it("is zero for no games, and never negative", () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(0, 5)).toBe(0);
  });
});

describe("computeInsights", () => {
  it("counts the record over every finished match", () => {
    expect(insights.matchesPlayed).toBe(8);
    expect(insights.wins).toBe(4);
    expect(insights.losses).toBe(4);
    expect(insights.draws).toBe(0);
    expect(insights.winRate).toBeCloseTo(0.5, 5);
  });

  it("splits the last 30 days out of the all-time record", () => {
    // Four of the eight were three days ago; the rest were sixty.
    expect(insights.last30.matches).toBe(4);
    expect(insights.last30.wins).toBe(2);
    expect(insights.allTime.matches).toBe(8);
  });

  it("adds up points from my side of the net", () => {
    // 21+21+12+8 + 21+14+21+17
    expect(insights.allTime.pointsFor).toBe(135);
    // 10+15+21+21 + 19+21+11+21
    expect(insights.allTime.pointsAgainst).toBe(139);
    expect(insights.last30.pointsFor).toBe(73);
  });

  it("reads streaks off the chronological run", () => {
    // W W L L | W L W L  → currently on one loss, best win run is two.
    expect(insights.formAll).toEqual(["W", "W", "L", "L", "W", "L", "W", "L"]);
    expect(insights.currentStreak).toEqual({ kind: "L", count: 1 });
    expect(insights.bestWinStreak).toBe(2);
    expect(insights.worstLossStreak).toBe(2);
    expect(insights.form).toEqual(["L", "W", "L", "W", "L"]);
  });

  it("merges a person across sessions by account, and by name when they have none", () => {
    // Rizky is two player rows with one account; Dewi is two rows with none
    // and different capitalisation. Both should appear once.
    const partnerKeys = insights.topPartners.map((p) => p.label).sort();
    expect(partnerKeys).toEqual(["Dewi", "Rizky"]);
  });

  it("ranks the better partner first and carries the head-to-head", () => {
    const [first, second] = insights.topPartners;
    expect(first.label).toBe("Rizky");
    expect(first.matches).toBe(4);
    expect(first.wins).toBe(3);
    expect(first.losses).toBe(1);
    expect(first.userId).toBe(RIZKY); // so the row can link to /u/<id>
    expect(first.avatarUrl).toBe("https://cdn/r.png");
    expect(second.label).toBe("Dewi");
    expect(second.wins).toBe(1);
    expect(second.userId).toBeNull(); // no account — the row must not link
    expect(first.score).toBeGreaterThan(second.score);
  });

  it("names the rival who beats me most often, not the one I face most", () => {
    // Budi faced me eight times and won four of them. Rizky faced me four
    // times and won three. Volume isn't the question — the ranking has to
    // prefer Rizky, and this is exactly the case a raw count gets wrong.
    const [rival, second] = insights.topRivals;
    expect(rival.label).toBe("Rizky");
    expect(rival.matches).toBe(4);
    expect(rival.wins).toBe(1); // my wins against him
    expect(rival.losses).toBe(3);
    expect(second.label).toBe("Budi");
    expect(second.matches).toBe(8);
    expect(rival.score).toBeGreaterThan(second.score);
  });

  it("counts most-played-with by time on court, not by results", () => {
    // Budi was on the other side of all eight; Rizky was partner four times
    // and opponent four — also eight. A genuine tie, broken by name so the
    // answer doesn't depend on the order the server returned the rows in.
    expect(insights.mostPlayedWith?.matches).toBe(8);
    expect(insights.mostPlayedWith?.label).toBe("Budi");
  });

  it("keeps quiet until four games together", () => {
    const thin = computeInsights(build(SPECS.slice(0, 2)));
    expect(thin.matchesPlayed).toBe(2);
    expect(thin.topPartners).toEqual([]); // 2 games with Rizky is not a partner
    expect(thin.topRivals).toEqual([]);
    expect(thin.mostPlayedWith?.matches).toBe(2); // frequency has no minimum
  });

  it("returns the empty shape rather than throwing on an empty payload", () => {
    const none = computeInsights({});
    expect(none.matchesPlayed).toBe(0);
    expect(none.topPartners).toEqual([]);
    expect(none.currentStreak).toBeNull();
  });
});
