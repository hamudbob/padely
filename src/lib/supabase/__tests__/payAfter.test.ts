import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Paying after the night (0082). The server decides who owes
 * (supabase/tests/pay_after_test.sql); these check the app reads it and
 * survives a database without 0082.
 */

const rpc = vi.fn();
vi.mock("../client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("../../push", () => ({ ensurePushRegistered: vi.fn() }));

import { getCallupExtras, getCallupWalkins, getClubMoney, setCallupCollecting, setCallupWalkinPayment } from "../eventQueries";

beforeEach(() => rpc.mockReset());

describe("before 0082", () => {
  it("nothing owed, no walk-ins, not played", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function get_club_money does not exist" } });
    expect(await getClubMoney("c1")).toEqual({ collect: [], owe: [] });
    expect(await getCallupWalkins("e1")).toEqual([]);
    rpc.mockResolvedValue({ data: { member: true, payment_mode: "tick", in_spots: 4, paid_spots: 1, me: null }, error: null });
    const x = await getCallupExtras("e1");
    expect(x?.played).toBe(false);
    expect(x?.collectingClosed).toBe(false);
  });
});

describe("reading", () => {
  it("collect and owe", async () => {
    rpc.mockResolvedValue({
      data: {
        collect: [{ event_id: "e1", slug: "tuesday", title: "Tuesday", scheduled_at: "2026-11-04T12:00:00Z", in_spots: 8, paid_spots: 5, to_check: 1 }],
        owe: [{ event_id: "e1", slug: null, title: "Tuesday", scheduled_at: "2026-11-04T12:00:00Z", cost: "IDR 120k", payment_mode: "tick", spots: 2, has_receipt: false }],
      },
      error: null,
    });
    const m = await getClubMoney("c1");
    expect(m.collect[0]).toMatchObject({ eventId: "e1", slug: "tuesday", inSpots: 8, paidSpots: 5, toCheck: 1 });
    expect(m.owe[0]).toMatchObject({ eventId: "e1", slug: null, cost: "IDR 120k", paymentMode: "tick", spots: 2, hasReceipt: false });
  });

  it("a played, closed night", async () => {
    rpc.mockResolvedValue({ data: { member: true, payment_mode: "tick", played: true, collecting_closed: true, me: null }, error: null });
    const x = await getCallupExtras("e1");
    expect(x?.played).toBe(true);
    expect(x?.collectingClosed).toBe(true);
  });
});

describe("writing", () => {
  it("ticks a walk-in by name key", async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await setCallupWalkinPayment("e1", "joko", true);
    expect(rpc).toHaveBeenCalledWith("set_callup_walkin_payment", { p_event_id: "e1", p_name_key: "joko", p_paid: true });
    await setCallupCollecting("e1", true);
    expect(rpc).toHaveBeenCalledWith("set_callup_collecting", { p_event_id: "e1", p_done: true });
  });

  it("a refusal is an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the club's owner and admins can mark payments." } });
    await expect(setCallupWalkinPayment("e1", "joko", true)).rejects.toThrow(/owner/);
  });
});
