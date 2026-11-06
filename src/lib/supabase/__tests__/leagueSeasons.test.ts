import { describe, it, expect, vi } from "vitest";

/**
 * The league by season, and the Champions Hall's League tab (Phase 2, Nov
 * 2026). A fake Supabase answers the handful of reads leagueQueries makes.
 */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};

function query(table: string) {
  let rows = [...(db[table] ?? [])];
  const q: any = {
    select: () => q,
    eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), q),
    gte: (col: string, v: string) => ((rows = rows.filter((r) => String(r[col]) >= v)), q),
    lt: (col: string, v: string) => ((rows = rows.filter((r) => String(r[col]) < v)), q),
    order: (col: string, o: { ascending: boolean }) => (
      (rows = rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (o.ascending ? 1 : -1))), q
    ),
    limit: (n: number) => ((rows = rows.slice(0, n)), q),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f),
  };
  return q;
}

vi.mock("../client", () => ({
  supabase: {
    from: (t: string) => query(t),
    rpc: (name: string) => Promise.resolve({ data: name === "get_club_sessions" ? db.sessions : null, error: null }),
  },
}));
vi.mock("../profileQueries", () => ({
  getProfiles: (ids: string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, { displayName: id.toUpperCase(), avatarUrl: null, rating: 1500 }]))),
}));

import { getClubLeague, getClubLeagueHistory } from "../leagueQueries";

const CLUB = "club-1";
function night(id: string, date: string, ranking: string[]) {
  (db.sessions ??= []).push({ id, counts_for_league: true });
  ranking.forEach((u, i) =>
    (db.session_results ??= []).push({
      club_id: CLUB, user_id: u, session_id: id, session_date: date, rank: i + 1, field_size: ranking.length,
      player_count: ranking.length, placement_points: ranking.length - i, podium_bonus: [3, 2, 1][i] ?? 0, wins: 3 - i, perf_adj: 0.5,
    }),
  );
}

db.clubs = [{ id: CLUB, league_period: "monthly", league_min_sessions: 1 }];
db.club_members = ["ana", "budi", "citra", "dewi"].map((u) => ({ club_id: CLUB, user_id: u }));
db.club_season_rules = [{ club_id: CLUB, starts_at: "2000-01-01T00:00:00Z", length: "monthly" }];
night("s1", "2026-09-08T12:00:00Z", ["ana", "budi", "citra", "dewi"]);
night("s2", "2026-10-06T12:00:00Z", ["budi", "ana", "dewi", "citra"]);
night("s3", "2026-11-03T12:00:00Z", ["citra", "ana", "budi", "dewi"]);

const NOW = new Date("2026-11-06T09:00:00Z");

describe("league by season", () => {
  it("the season in progress is Season 3 · Nov 2026, counted from the first night", async () => {
    const b = await getClubLeague(CLUB, 0, NOW);
    expect(b.periodLabel).toBe("Season 3 · Nov 2026");
    expect(b.seasonCount).toBe(3);
    expect(b.rows[0].userId).toBe("citra");
  });

  it("paging back stops at Season 1", async () => {
    const b = await getClubLeague(CLUB, -9, NOW);
    expect(b.periodLabel).toBe("Season 1 · Sep 2026");
    expect(b.offset).toBe(-2);
    expect(b.rows[0].userId).toBe("ana");
  });

  it("a planned change shows on the season in progress", async () => {
    db.club_season_rules.push({ club_id: CLUB, starts_at: "2026-12-01T00:00:00Z", length: "3_month" });
    const b = await getClubLeague(CLUB, 0, NOW);
    expect(b.pendingChange).toEqual({ length: "3_month", startsAt: "2026-12-01T00:00:00.000Z" });
    db.club_season_rules.pop();
  });
});

describe("Champions Hall, League tab", () => {
  it("each finished season's top three, newest first, and the season in progress", async () => {
    const h = await getClubLeagueHistory(CLUB, NOW);
    expect(h.finished.map((s) => s.label)).toEqual(["Season 2 · Oct 2026", "Season 1 · Sep 2026"]);
    expect(h.finished[0].podium.map((r) => r.userId)).toEqual(["budi", "ana", "dewi"]);
    expect(h.current?.label).toBe("Season 3 · Nov 2026");
    expect(h.titles.map((t) => [t.userId, t.titles])).toEqual([["ana", 1], ["budi", 1]]);
  });

  it("a champion who later left the club keeps the title", async () => {
    db.club_members = db.club_members.filter((m) => m.user_id !== "ana");
    const h = await getClubLeagueHistory(CLUB, NOW);
    expect(h.finished[1].podium[0].userId).toBe("ana");
    // ...while the live table is current members only, as before.
    const b = await getClubLeague(CLUB, -2, NOW);
    expect(b.rows.map((r) => r.userId)).not.toContain("ana");
  });

  it("the club's minimum nights applies to the podium", async () => {
    db.clubs[0].league_min_sessions = 2;
    const h = await getClubLeagueHistory(CLUB, NOW);
    expect(h.finished.length).toBe(0); // nobody played 2 nights in one month
    db.clubs[0].league_min_sessions = 1;
  });
});
