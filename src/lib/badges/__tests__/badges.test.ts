import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { BADGES, BADGE_BY_ID, CLUB_BADGES, PLAYER_BADGES } from "../catalog";
import { BadgesData, badgeCaption, badgeChip, badgeState, buildShelf, earnedOnNight } from "../model";

/**
 * Badges (Nov 2026). The server decides who has earned what (0087); these
 * check the app names, counts and draws it the way the list agreed with Hamud
 * says, and that the app's list can't drift from the server's.
 */

const empty: BadgesData = { earned: [], progress: [], clubs: [], eliteSeen: false };
const CLUB = { id: "c1", name: "PLER", logoUrl: null, owner: false };

describe("the list", () => {
  it("is 18 for the player and 12 for each club", () => {
    expect(PLAYER_BADGES).toHaveLength(18);
    expect(CLUB_BADGES).toHaveLength(12);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(30);
  });

  it("matches the server's badge_rules() exactly: ids, kinds and levels", () => {
    const sql = readFileSync(resolve(__dirname, "../../../../supabase/migrations/0087_badges.sql"), "utf8");
    const block = sql.slice(sql.indexOf("create or replace function badge_rules()"), sql.indexOf("create or replace function badge_name"));
    const rows = [...block.matchAll(/\('([a-z_]+)',\s*'(player|club)',\s*'(levels|repeat|once)',\s*(null(?:::integer\[\])?|array\[([\d,]+)\])\)/g)];
    expect(rows).toHaveLength(30);
    for (const [, id, scope, kind, , levels] of rows) {
      const def = BADGE_BY_ID.get(id)!;
      expect(def, id).toBeTruthy();
      expect(def.scope).toBe(scope);
      // tier and hidden are "once" on the server
      expect(def.kind === "tier" || def.kind === "hidden" ? "once" : def.kind).toBe(kind);
      expect(def.levels ?? null).toEqual(levels ? levels.split(",").map(Number) : null);
    }
  });
});

describe("how a badge stands", () => {
  const nights = BADGE_BY_ID.get("nights_played")!;

  it("levels: first, in between, top, with the next one to reach", () => {
    const at = (lv: number[], count: number) =>
      badgeState(nights, null, {
        ...empty,
        earned: lv.map((l) => ({ clubId: null, badge: "nights_played", level: l, earnedAt: `2026-10-0${lv.indexOf(l) + 1}T12:00:00Z`, sessionId: null, detail: null })),
        progress: [{ clubId: null, badge: "nights_played", value: count, detail: null }],
      });
    expect(at([], 0)).toMatchObject({ isEarned: false, stage: "locked", next: 1, level: null });
    expect(at([1], 3)).toMatchObject({ stage: "first", level: 1, next: 10, count: 3 });
    expect(at([1, 10, 25], 31)).toMatchObject({ stage: "middle", level: 25, next: 50 });
    expect(at([1, 10, 25, 50, 100, 250], 260)).toMatchObject({ stage: "top", level: 250, next: null });
    expect(badgeChip(at([1, 10, 25], 31))).toBe("25");
    expect(badgeChip(at([], 0))).toBe("1");
    expect(badgeCaption(at([1, 10, 25], 31), { self: true })).toBe("31 of 50");
  });

  it("repeat: ×N from the second time", () => {
    const def = BADGE_BY_ID.get("clean_sheet")!;
    const s = (n: number) =>
      badgeState(def, null, {
        ...empty,
        earned: Array.from({ length: n }, (_, i) => ({ clubId: null, badge: "clean_sheet", level: i + 1, earnedAt: "2026-10-01T12:00:00Z", sessionId: null, detail: null })),
      });
    expect(badgeChip(s(1))).toBeNull();
    expect(badgeChip(s(3))).toBe("×3");
    expect(badgeCaption(s(3), { self: false })).toBe("3 times");
  });

  it("a rival is named only on your own profile", () => {
    const def = BADGE_BY_ID.get("rivalry")!;
    const s = badgeState(def, null, {
      ...empty,
      earned: [{ clubId: null, badge: "rivalry", level: 1, earnedAt: "2026-10-01T12:00:00Z", sessionId: null, detail: { name: "Rizky" } }],
    });
    expect(badgeCaption(s, { self: true })).toBe("Rizky · 20 games");
    expect(badgeCaption(s, { self: false })).toBe("20 games, one opponent");
  });

  it("a club's badges are the club's, not another club's", () => {
    const def = BADGE_BY_ID.get("club_nights")!;
    const data: BadgesData = {
      ...empty,
      earned: [{ clubId: "c2", badge: "club_nights", level: 1, earnedAt: "2026-10-01T12:00:00Z", sessionId: null, detail: null }],
    };
    expect(badgeState(def, "c1", data).isEarned).toBe(false);
    expect(badgeState(def, "c2", data).isEarned).toBe(true);
  });
});

describe("the shelf", () => {
  it("counts badges once, not levels, and leaves Founder out for a member", () => {
    const data: BadgesData = {
      ...empty,
      clubs: [CLUB, { id: "c2", name: "Mine", logoUrl: null, owner: true }],
      earned: [
        { clubId: null, badge: "nights_played", level: 1, earnedAt: "2026-10-01T12:00:00Z", sessionId: "s1", detail: null },
        { clubId: null, badge: "nights_played", level: 10, earnedAt: "2026-10-09T12:00:00Z", sessionId: "s9", detail: null },
        { clubId: "c1", badge: "night_champion", level: 1, earnedAt: "2026-10-09T12:00:00Z", sessionId: "s9", detail: null },
      ],
      progress: [
        { clubId: null, badge: "nights_played", value: 22, detail: null },
        { clubId: "c1", badge: "podiums", value: 4, detail: null },
        { clubId: null, badge: "peak_rating", value: 1612.4, detail: null },
      ],
    };
    const shelf = buildShelf(data);
    expect(shelf.earnedCount).toBe(2);
    expect(shelf.totalCount).toBe(18 + 11 + 12);
    expect(shelf.clubs[0].badges.some((b) => b.def.id === "founder")).toBe(false);
    expect(shelf.clubs[1].badges.some((b) => b.def.id === "founder")).toBe(true);
    // 4 of 5 podiums is closer than 22 of 25 nights? 0.8 vs 0.88: nights.
    expect(shelf.nextUp?.def.id).toBe("nights_played");
    expect(shelf.peakRating).toBe(1612);
  });

  it("a night's badges: each badge once, at the highest level it gave", () => {
    const data: BadgesData = {
      ...empty,
      clubs: [CLUB],
      earned: [
        { clubId: null, badge: "nights_played", level: 1, earnedAt: "2026-10-01T12:00:00Z", sessionId: "s1", detail: null },
        { clubId: "c1", badge: "club_nights", level: 1, earnedAt: "2026-10-01T12:00:00Z", sessionId: "s1", detail: null },
        { clubId: null, badge: "host", level: 1, earnedAt: "2026-10-01T12:00:00Z", sessionId: "s1", detail: null },
        { clubId: null, badge: "games_played", level: 100, earnedAt: "2026-10-08T12:00:00Z", sessionId: "s2", detail: null },
      ],
    };
    const n = earnedOnNight(data, "s1");
    expect(n.map((x) => x.state.def.id).sort()).toEqual(["club_nights", "host", "nights_played"]);
    expect(earnedOnNight(data, "s3")).toEqual([]);
  });
});
