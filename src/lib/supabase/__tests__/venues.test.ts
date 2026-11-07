import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Saved venues and the admin's Needs-you list (0081). The server owns the
 * rules (supabase/tests/venues_test.sql); these check the app only ever opens
 * a map link it trusts, and survives a database without 0081.
 */

const rpc = vi.fn();
vi.mock("../client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("../../push", () => ({ ensurePushRegistered: vi.fn() }));

import { getCallupExtras, getClubAdminTodo, listClubVenues, mapsLinkFor, safeMapsUrl, setCallupVenue, venueKey } from "../eventQueries";

beforeEach(() => rpc.mockReset());

describe("map links", () => {
  it("accepts Google and Apple Maps over https", () => {
    for (const u of [
      "https://maps.app.goo.gl/AbC123",
      "https://goo.gl/maps/xyz",
      "https://www.google.com/maps/place/Padel+Kemang",
      "https://google.co.id/maps?q=x",
      "https://maps.google.com/?q=-6.2,106.8",
      "https://maps.apple.com/?q=Padel",
    ]) {
      expect(safeMapsUrl(u)).toBe(u);
    }
  });

  it("refuses anything else", () => {
    for (const u of [
      "http://maps.app.goo.gl/AbC123",
      "https://maps.app.goo.gl.evil.com/x",
      "https://evil.com/?https://maps.apple.com",
      "javascript:alert(1)",
      "https://www.google.com/search?q=padel",
      'https://maps.apple.com/"onmouseover=x',
      "https://maps.apple.com/ with space",
      "https://maps.apple.com/" + "a".repeat(500),
      "",
      null,
    ]) {
      expect(safeMapsUrl(u)).toBeNull();
    }
  });

  it("Open map: the saved link, else a search for the name, else nothing", () => {
    expect(mapsLinkFor("Padel Kemang", "https://maps.app.goo.gl/AbC")).toBe("https://maps.app.goo.gl/AbC");
    expect(mapsLinkFor("Padel & Co, Kemang", "https://evil.com")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Padel%20%26%20Co%2C%20Kemang",
    );
    expect(mapsLinkFor("  ", null)).toBeNull();
    expect(mapsLinkFor(null)).toBeNull();
  });

  it("venue names match however they're typed", () => {
    expect(venueKey("  Padel   Kemang ")).toBe(venueKey("padel kemang"));
  });
});

describe("before 0081", () => {
  it("no venues and nothing to check, instead of an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function list_club_venues does not exist" } });
    expect(await listClubVenues("c1")).toEqual([]);
    expect(await getClubAdminTodo("c1")).toEqual([]);
  });
});

describe("reading", () => {
  it("venues drop a link the app wouldn't open", async () => {
    rpc.mockResolvedValue({
      data: [
        { id: "v1", name: "Padel Kemang", maps_url: "https://maps.app.goo.gl/A", use_count: 4 },
        { id: "v2", name: "Elsewhere", maps_url: "https://evil.com", use_count: 0 },
      ],
      error: null,
    });
    const v = await listClubVenues("c1");
    expect(v.map((x) => x.mapsUrl)).toEqual(["https://maps.app.goo.gl/A", null]);
    expect(v[0].useCount).toBe(4);
  });

  it("non-members still get the night's map link", async () => {
    rpc.mockResolvedValue({ data: { member: false, location_url: "https://maps.apple.com/?q=x" }, error: null });
    const x = await getCallupExtras("e1");
    expect(x?.member).toBe(false);
    expect(x?.locationUrl).toBe("https://maps.apple.com/?q=x");
  });

  it("needs-you rows", async () => {
    rpc.mockResolvedValue({ data: [{ event_id: "e1", title: "Tue", scheduled_at: "2026-11-10T12:00:00Z", to_check: 3 }], error: null });
    expect(await getClubAdminTodo("c1")).toEqual([{ eventId: "e1", title: "Tue", scheduledAt: "2026-11-10T12:00:00Z", toCheck: 3 }]);
  });
});

describe("saving", () => {
  it("sends a blank name and link as null, and says whether to count it", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setCallupVenue("e1", "  ", "", false);
    expect(rpc).toHaveBeenCalledWith("set_callup_venue", { p_event_id: "e1", p_name: null, p_maps_url: null, p_count: false });
  });

  it("a refused link is an error the form can show", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only Google Maps or Apple Maps links" } });
    await expect(setCallupVenue("e1", "X", "https://evil.com", true)).rejects.toThrow(/Maps/);
  });
});
