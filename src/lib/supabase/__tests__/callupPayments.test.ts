import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Call-up payments (0080). The server owns the rules (supabase/tests/
 * callup_payments_test.sql); these check the app reads its answers the way
 * the screens expect, and survives a database without 0080.
 */

const rpc = vi.fn();
vi.mock("../client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("../../push", () => ({ ensurePushRegistered: vi.fn() }));

import { getCallupExtras, getCallupPayments, paymentModeOf, setCallupOptions } from "../eventQueries";
import { settingsFromRow } from "../teamQueries";

beforeEach(() => rpc.mockReset());

describe("payment mode", () => {
  it("anything unknown is no payment", () => {
    expect(paymentModeOf("receipt")).toBe("receipt");
    expect(paymentModeOf("tick")).toBe("tick");
    expect(paymentModeOf(undefined)).toBe("none");
    expect(paymentModeOf("cash")).toBe("none");
  });
});

describe("getCallupExtras", () => {
  it("maps the player's own status", async () => {
    rpc.mockResolvedValue({
      data: {
        member: true, notes: "BCA 123", payment_mode: "receipt", deadline: "2026-11-06T06:00:00Z",
        frozen_at: "2026-11-06T11:00:00Z", in_spots: 12, paid_spots: 8, is_admin: false,
        me: { spots: 2, paid: false, paid_at: null, has_receipt: true, receipt_at: "2026-11-05T10:00:00Z",
              rejected_reason: null, pay_by: null, moved_unpaid: false },
      },
      error: null,
    });
    const x = await getCallupExtras("e1");
    expect(rpc).toHaveBeenCalledWith("get_callup_extras", { p_event_id: "e1" });
    expect(x).toMatchObject({ member: true, notes: "BCA 123", paymentMode: "receipt", inSpots: 12, paidSpots: 8 });
    expect(x?.me).toMatchObject({ spots: 2, paid: false, hasReceipt: true, movedUnpaid: false, payBy: null });
  });

  it("is null (nothing new on screen) before 0080 is applied", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function get_callup_extras does not exist" } });
    expect(await getCallupExtras("e1")).toBeNull();
  });

  it("a non-member gets no notes", async () => {
    rpc.mockResolvedValue({ data: { member: false }, error: null });
    const x = await getCallupExtras("e1");
    expect(x?.member).toBe(false);
    expect(x?.notes).toBeNull();
    expect(x?.me).toBeNull();
  });
});

describe("admin", () => {
  it("lists payments with guests", async () => {
    rpc.mockResolvedValue({
      data: [{ user_id: "u1", display_name: "Budi", avatar_url: null, own_in: true, guests_in: 1,
               paid_at: null, has_receipt: true, receipt_at: "x", rejected_reason: null, pay_by: null }],
      error: null,
    });
    const rows = await getCallupPayments("e1");
    expect(rows[0]).toMatchObject({ userId: "u1", displayName: "Budi", guestsIn: 1, hasReceipt: true, paidAt: null });
  });

  it("blank notes are sent as null", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await setCallupOptions("e1", "tick", "   ");
    expect(rpc).toHaveBeenCalledWith("set_callup_options", { p_event_id: "e1", p_payment_mode: "tick", p_notes: null });
  });

  it("server messages come through", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the club's owner and admins can change this." } });
    await expect(setCallupOptions("e1", "receipt", null)).rejects.toThrow("owner and admins");
  });
});

describe("club defaults", () => {
  const base = {
    id: "c", name: "C", club_code: "X", logo_url: null, session_floor: 0, league_period: "monthly",
    league_min_sessions: 1, default_sort: "pointsPerSession", created_by: null, created_at: "",
  };
  it("reads the default payment mode and notes", () => {
    const s = settingsFromRow({ ...base, callup_defaults: { payment_mode: "receipt", notes: "QRIS at the desk" } });
    expect(s.callupDefaults.paymentMode).toBe("receipt");
    expect(s.callupDefaults.notes).toBe("QRIS at the desk");
  });
  it("ignores a mode it doesn't know", () => {
    const s = settingsFromRow({ ...base, callup_defaults: { payment_mode: "bitcoin" } });
    expect(s.callupDefaults.paymentMode).toBeNull();
  });
});
