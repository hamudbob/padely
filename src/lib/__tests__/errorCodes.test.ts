import { describe, it, expect } from "vitest";
import { codeFor } from "../errors";

/**
 * PostgREST answers .single() with PGRST116 for BOTH zero rows and several.
 * 13 Oct 2026: a session deleted from the server was reported as "Expected
 * one row, found several" — a duplicate hunt for something that was absent.
 */
describe("PGRST116", () => {
  const base = { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" };

  it("no rows is a missing session, not a duplicate", () => {
    expect(codeFor({ ...base, details: "The result contains 0 rows" })).toBe("PLR-3002");
  });

  it("several rows is still the duplicate code", () => {
    expect(codeFor({ ...base, details: "The result contains 2 rows" })).toBe("PLR-2002");
  });
});
