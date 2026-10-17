import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const { fetchText } = vi.hoisted(() => ({ fetchText: vi.fn() }));
vi.mock("@/lib/safeFetch", async (original) => ({
  ...(await original<typeof import("@/lib/safeFetch")>()),
  safeFetchText: fetchText,
}));

import { diffIcalImport, IcalSyncError, isFystayCalendarExport, refreshStaleIcalImport, syncListingIcalImport } from "./icalSync";

const d = (s: string) => new Date(s);

describe("diffIcalImport", () => {
  it("upserts every event when nothing exists yet", () => {
    const plan = diffIcalImport(
      [],
      [{ uid: "u1", start: d("2026-01-01"), end: d("2026-01-05") }],
    );
    expect(plan.toUpsert).toEqual([{ uid: "u1", start: d("2026-01-01"), end: d("2026-01-05") }]);
    expect(plan.toDeleteUids).toEqual([]);
  });

  it("leaves an unchanged event alone entirely", () => {
    const plan = diffIcalImport(
      [{ externalUid: "u1", startDate: d("2026-01-01"), endDate: d("2026-01-05") }],
      [{ uid: "u1", start: d("2026-01-01"), end: d("2026-01-05") }],
    );
    expect(plan.toUpsert).toEqual([]);
    expect(plan.toDeleteUids).toEqual([]);
  });

  it("upserts an event whose dates changed since last sync", () => {
    const plan = diffIcalImport(
      [{ externalUid: "u1", startDate: d("2026-01-01"), endDate: d("2026-01-05") }],
      [{ uid: "u1", start: d("2026-01-02"), end: d("2026-01-06") }],
    );
    expect(plan.toUpsert).toEqual([{ uid: "u1", start: d("2026-01-02"), end: d("2026-01-06") }]);
    expect(plan.toDeleteUids).toEqual([]);
  });

  it("deletes a previously-synced block whose event is no longer in the feed", () => {
    const plan = diffIcalImport(
      [{ externalUid: "gone", startDate: d("2026-01-01"), endDate: d("2026-01-05") }],
      [],
    );
    expect(plan.toUpsert).toEqual([]);
    expect(plan.toDeleteUids).toEqual(["gone"]);
  });

  it("handles a mix of new, unchanged, changed, and removed events in one diff", () => {
    const plan = diffIcalImport(
      [
        { externalUid: "unchanged", startDate: d("2026-01-01"), endDate: d("2026-01-05") },
        { externalUid: "changed", startDate: d("2026-02-01"), endDate: d("2026-02-05") },
        { externalUid: "removed", startDate: d("2026-03-01"), endDate: d("2026-03-05") },
      ],
      [
        { uid: "unchanged", start: d("2026-01-01"), end: d("2026-01-05") },
        { uid: "changed", start: d("2026-02-02"), end: d("2026-02-06") },
        { uid: "new", start: d("2026-04-01"), end: d("2026-04-05") },
      ],
    );
    expect(plan.toUpsert.map((e) => e.uid).sort()).toEqual(["changed", "new"]);
    expect(plan.toDeleteUids).toEqual(["removed"]);
  });

  it("is a no-op both ways for two empty lists", () => {
    expect(diffIcalImport([], [])).toEqual({ toUpsert: [], toDeleteUids: [] });
  });
});

describe("refreshStaleIcalImport", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const db = (listing: { icalImportUrl: string | null; icalSyncedAt: Date | null } | null) =>
    ({ listing: { findUnique: vi.fn(async () => listing) } }) as unknown as PrismaClient;

  it("re-syncs a calendar last synced more than 30 minutes ago", async () => {
    const sync = vi.fn(async () => ({ synced: 1, removed: 0 }));
    await refreshStaleIcalImport(db({ icalImportUrl: "https://x/cal.ics", icalSyncedAt: new Date("2026-10-12T11:00:00Z") }), "l1", { now, sync });
    expect(sync).toHaveBeenCalledWith(expect.anything(), "l1", { timeoutMs: 4000 });
  });

  it("re-syncs a calendar that has never synced", async () => {
    const sync = vi.fn(async () => null);
    await refreshStaleIcalImport(db({ icalImportUrl: "https://x/cal.ics", icalSyncedAt: null }), "l1", { now, sync });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("leaves a fresh calendar, or a listing without one, alone", async () => {
    const sync = vi.fn(async () => null);
    await refreshStaleIcalImport(db({ icalImportUrl: "https://x/cal.ics", icalSyncedAt: new Date("2026-10-12T11:45:00Z") }), "l1", { now, sync });
    await refreshStaleIcalImport(db({ icalImportUrl: null, icalSyncedAt: null }), "l1", { now, sync });
    expect(sync).not.toHaveBeenCalled();
  });

  it("lets the booking go ahead when the other site is down", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sync = vi.fn(async () => {
      throw new Error("timeout");
    });
    await expect(
      refreshStaleIcalImport(db({ icalImportUrl: "https://x/cal.ics", icalSyncedAt: null }), "l1", { now, sync }),
    ).resolves.toBeUndefined();
    error.mockRestore();
  });
});

describe("syncListingIcalImport", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const feed = (...events: [string, string, string][]) =>
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
    events
      .map(([uid, start, end]) => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nEND:VEVENT\r\n`)
      .join("") +
    "END:VCALENDAR\r\n";

  let existing: { externalUid: string; startDate: Date; endDate: Date }[];
  const upsert = vi.fn();
  const deleteMany = vi.fn();
  const listingUpdate = vi.fn();
  const bookingTouched = vi.fn();
  const db = () =>
    ({
      listing: {
        findUnique: async () => ({ id: "l1", icalImportUrl: "https://www.airbnb.co.uk/calendar/ical/1.ics" }),
        update: listingUpdate,
      },
      availabilityBlock: {
        findMany: async (args: { where: { source: string } }) => {
          // The sync only ever reads (and so only ever changes) imported blocks.
          expect(args.where.source).toBe("ICAL_IMPORT");
          return existing;
        },
        upsert,
        deleteMany,
      },
      booking: new Proxy({}, { get: () => bookingTouched }),
    }) as unknown as PrismaClient;

  beforeEach(() => {
    existing = [];
    for (const fn of [upsert, deleteMany, listingUpdate, bookingTouched, fetchText]) fn.mockReset();
  });

  it("imports new busy dates, updates moved ones and removes stale imported ones - and nothing else", async () => {
    existing = [
      { externalUid: "same", startDate: d("2027-03-01"), endDate: d("2027-03-04") },
      { externalUid: "moved", startDate: d("2027-04-01"), endDate: d("2027-04-03") },
      { externalUid: "gone", startDate: d("2027-05-01"), endDate: d("2027-05-02") },
    ];
    fetchText.mockResolvedValue({
      ok: true,
      status: 200,
      text: feed(["same", "20270301", "20270304"], ["moved", "20270402", "20270405"], ["new", "20270601", "20270607"]),
    });

    expect(await syncListingIcalImport(db(), "l1")).toEqual({ synced: 2, removed: 1 });
    expect(upsert.mock.calls.map(([args]) => args.where.listingId_externalUid.externalUid).sort()).toEqual(["moved", "new"]);
    expect(upsert.mock.calls[0][0].create.source).toBe("ICAL_IMPORT");
    // Stale removal is limited to this listing's imported blocks: a host's
    // own blocks and every booking stay exactly as they were.
    expect(deleteMany).toHaveBeenCalledWith({ where: { listingId: "l1", source: "ICAL_IMPORT", externalUid: { in: ["gone"] } } });
    expect(bookingTouched).not.toHaveBeenCalled();
    expect(listingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ icalSyncError: null, icalSyncFailedAt: null }) }),
    );
  });

  it("keeps the last good dates when the other site returns an error or sign-in page instead of a calendar", async () => {
    existing = [{ externalUid: "keep", startDate: d("2027-03-01"), endDate: d("2027-03-04") }];
    fetchText.mockResolvedValue({ ok: true, status: 200, text: "<!DOCTYPE html><html>Please sign in</html>" });

    await expect(syncListingIcalImport(db(), "l1")).rejects.toThrow(IcalSyncError);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(listingUpdate).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { icalSyncError: expect.stringMatching(/didn't return a calendar/), icalSyncFailedAt: expect.any(Date) },
    });
  });

  it("records a refused link (e.g. a reset Airbnb export) for the host to fix", async () => {
    fetchText.mockResolvedValue({ ok: false, status: 403, text: "" });
    await expect(syncListingIcalImport(db(), "l1")).rejects.toThrow(/refused the calendar link/);
    expect(listingUpdate.mock.calls[0][0].data.icalSyncError).toMatch(/current export link/);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("an empty but valid calendar clears the imported dates (everything there was cancelled)", async () => {
    existing = [{ externalUid: "old", startDate: d("2027-03-01"), endDate: d("2027-03-04") }];
    fetchText.mockResolvedValue({ ok: true, status: 200, text: feed() });
    expect(await syncListingIcalImport(db(), "l1")).toEqual({ synced: 0, removed: 1 });
  });
});

describe("isFystayCalendarExport", () => {
  it("spots FYStay's own export link so it can't be imported back in", () => {
    expect(isFystayCalendarExport("https://www.fystay.co.uk/api/listings/abc/calendar.ics?token=x", "https://www.fystay.co.uk")).toBe(true);
    expect(isFystayCalendarExport("https://fystay.vercel.app/api/listings/abc/calendar.ics?token=x", "https://www.fystay.co.uk")).toBe(true);
    expect(isFystayCalendarExport("https://www.airbnb.co.uk/calendar/ical/123.ics?s=abc", "https://www.fystay.co.uk")).toBe(false);
  });
});
