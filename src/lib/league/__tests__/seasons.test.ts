import { describe, it, expect } from "vitest";
import { normaliseRules, seasonBounds, seasonsUpTo, seasonFor, plannedChange, pendingRule, seasonDates, SeasonRule } from "../seasons";

const d = (y: number, m: number, day = 1) => new Date(Date.UTC(y, m - 1, day));
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("seasons", () => {
  it("with one rule, seasons line up with the calendar like the old periods", () => {
    const rules = normaliseRules([], "3_month");
    const b = seasonBounds(rules, d(2026, 11, 6));
    expect([iso(b.start), iso(b.end)]).toEqual(["2026-10-01", "2027-01-01"]);
    expect(seasonDates(b.start, b.end)).toBe("Oct–Dec 2026");
    const y = seasonBounds(normaliseRules([], "yearly"), d(2026, 11, 6));
    expect(seasonDates(y.start, y.end)).toBe("2026");
    const m = seasonBounds(normaliseRules([], "monthly"), d(2026, 11, 6));
    expect(seasonDates(m.start, m.end)).toBe("Nov 2026");
  });

  it("numbers from the club's first league night", () => {
    const rules = normaliseRules([], "monthly");
    const list = seasonsUpTo(rules, d(2026, 8, 19), d(2026, 11, 6));
    expect(list.map((s) => s.label)).toEqual([
      "Season 1 · Aug 2026", "Season 2 · Sep 2026", "Season 3 · Oct 2026", "Season 4 · Nov 2026",
    ]);
  });

  it("no league night yet: the season in progress is Season 1", () => {
    expect(seasonFor(normaliseRules([], "monthly"), null, d(2026, 11, 6)).label).toBe("Season 1 · Nov 2026");
  });

  it("a change starts when the season in progress ends", () => {
    const rules = normaliseRules([], "monthly");
    expect(iso(plannedChange(rules, d(2026, 11, 6), "3_month")!.startsAt)).toBe("2026-12-01");
    expect(plannedChange(rules, d(2026, 11, 6), "monthly")).toBeNull();
  });

  it("after the change: monthly to November, then 3-month seasons from 1 Dec", () => {
    const rules: SeasonRule[] = normaliseRules([{ startsAt: d(2000, 1), length: "monthly" }, { startsAt: d(2026, 12), length: "3_month" }], "monthly");
    const list = seasonsUpTo(rules, d(2026, 10, 3), d(2027, 3, 15));
    expect(list.map((s) => s.label)).toEqual([
      "Season 1 · Oct 2026", "Season 2 · Nov 2026", "Season 3 · Dec 2026–Feb 2027", "Season 4 · Mar–May 2027",
    ]);
    expect(pendingRule(rules, d(2026, 11, 6))?.length).toBe("3_month");
    expect(pendingRule(rules, d(2026, 12, 2))).toBeNull();
  });

  it("changing back before the new length starts cancels the change", () => {
    const rules = normaliseRules([{ startsAt: d(2000, 1), length: "monthly" }, { startsAt: d(2026, 12), length: "3_month" }], "monthly");
    // The next season would be 3 months; asking for 3 months again changes nothing,
    // asking for monthly is a change (the caller then removes the pending rule).
    expect(plannedChange(rules, d(2026, 11, 6), "3_month")).toBeNull();
    expect(iso(plannedChange(rules, d(2026, 11, 6), "monthly")!.startsAt)).toBe("2026-12-01");
  });
});
