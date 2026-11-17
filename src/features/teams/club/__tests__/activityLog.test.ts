import { describe as suite, it, expect, vi } from "vitest";

vi.mock("../../../../lib/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("../../../../lib/push", () => ({ ensurePushRegistered: vi.fn() }));

import { describe } from "../ActivityLog";
import type { CallupLogEntry } from "../../../../lib/supabase/eventQueries";

const e = (p: Partial<CallupLogEntry>): CallupLogEntry => ({
  at: "2026-11-17T12:02:31.482Z",
  actorName: null,
  automatic: false,
  subjectName: null,
  isGuest: false,
  action: "",
  detail: {},
  ...p,
});

suite("activity lines", () => {
  it("a player's own answer", () => {
    expect(describe(e({ actorName: "Budi", subjectName: "Budi", action: "answered_in" }))).toMatchObject({ who: "Budi", text: "answered I'm in", tone: "player" });
  });
  it("an admin moving someone, by name", () => {
    expect(describe(e({ actorName: "Hamud", subjectName: "Citra", action: "admin_took_out" }))).toMatchObject({ who: "Hamud", text: "took Citra out", tone: "admin" });
  });
  it("Padelier's own moves", () => {
    expect(describe(e({ automatic: true, subjectName: "Dewi", action: "moved_up" }))).toMatchObject({ who: "Padelier", text: "moved Dewi up from the waiting list", tone: "auto" });
    expect(describe(e({ automatic: true, subjectName: "Dewi", action: "moved_to_waitlist", detail: { cause: "unpaid" } })).text).toBe(
      "moved Dewi to the waiting list: not paid in time",
    );
  });
  it("guests say whose guest they are", () => {
    expect(describe(e({ actorName: "Hamud", subjectName: "Rina", isGuest: true, action: "admin_moved_in", detail: { guest_of: "Dewi" } })).text).toBe("moved Rina (Dewi's guest) in");
    expect(describe(e({ actorName: "Dewi", subjectName: "Rina", isGuest: true, action: "receipt_uploaded" })).text).toBe("uploaded a receipt for Rina");
  });
  it("a rejected receipt keeps the reason", () => {
    expect(describe(e({ actorName: "Hamud", subjectName: "Budi", action: "receipt_rejected", detail: { reason: "Wrong amount" } })).text).toBe("rejected Budi's receipt: “Wrong amount”");
  });
});
