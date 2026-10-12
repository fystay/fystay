import { beforeEach, describe, expect, it, vi } from "vitest";

// Who may sync, reset or change a listing's calendar links: only its host.
const { state, listingUpdate, sync, blocksDeleteMany } = vi.hoisted(() => ({
  state: { userId: "host_1" as string | null },
  listingUpdate: vi.fn(),
  sync: vi.fn(),
  blocksDeleteMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => (state.userId ? { user: { id: state.userId, role: "HOST" } } : null) }));
vi.mock("@/lib/icalSync", async (original) => ({
  ...(await original<typeof import("@/lib/icalSync")>()),
  syncListingIcalImport: sync,
}));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    // The update runs in a transaction (host review records) - same client here.
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    listing: {
      findUnique: async () => ({
        id: "listing_1",
        hostId: "host_1",
        icalImportUrl: "https://www.airbnb.co.uk/calendar/ical/1.ics",
        propertyType: "APARTMENT",
        minNights: 1,
        maxNights: null,
        pricePerNightCents: 9000,
        weekendPricePerNightCents: null,
        city: "Blackpool",
        lastMinuteDiscountPercent: null,
        lastMinuteWindowDays: null,
      }),
      update: async (args: { data: Record<string, unknown> }) => (listingUpdate(args), { icalExportToken: "new", published: true }),
    },
    availabilityBlock: { deleteMany: blocksDeleteMany },
  };
  return { prisma };
});

import { POST as syncNow } from "./ical-sync/route";
import { POST as resetToken } from "./calendar-token/route";
import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ id: "listing_1" }) };
const patch = (body: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  state.userId = "host_1";
  for (const fn of [listingUpdate, sync, blocksDeleteMany]) fn.mockReset();
  sync.mockResolvedValue({ synced: 0, removed: 0 });
});

describe("calendar links are the listing host's alone", () => {
  it("refuses other hosts and signed-out callers", async () => {
    for (const userId of ["host_2", null]) {
      state.userId = userId;
      const expected = userId ? 403 : 401;
      expect((await syncNow(new Request("http://x", { method: "POST" }), ctx)).status).toBe(expected);
      expect((await resetToken(new Request("http://x", { method: "POST" }), ctx)).status).toBe(expected);
      expect((await patch({ icalImportUrl: "https://evil.example/cal.ics" })).status).toBe(expected);
    }
    expect(sync).not.toHaveBeenCalled();
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it("lets the host replace the private export link with a new random one", async () => {
    const res = await resetToken(new Request("http://x", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(listingUpdate.mock.calls[0][0].data.icalExportToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe("changing the import link", () => {
  it("removes only the imported dates when the link is cleared, and resets the sync state", async () => {
    expect((await patch({ icalImportUrl: null })).status).toBe(200);
    expect(blocksDeleteMany).toHaveBeenCalledWith({ where: { listingId: "listing_1", source: "ICAL_IMPORT" } });
    expect(listingUpdate.mock.calls[0][0].data).toMatchObject({ icalImportUrl: null, icalSyncedAt: null, icalSyncError: null });
  });

  it("keeps imported dates until the new link's first sync replaces them", async () => {
    expect((await patch({ icalImportUrl: "https://www.airbnb.co.uk/calendar/ical/2.ics" })).status).toBe(200);
    expect(blocksDeleteMany).not.toHaveBeenCalled();
    expect(listingUpdate.mock.calls[0][0].data).toMatchObject({ icalSyncedAt: null });
  });

  it("refuses FYStay's own export link and non-web links", async () => {
    expect((await patch({ icalImportUrl: "https://www.fystay.co.uk/api/listings/x/calendar.ics?token=t" })).status).toBe(400);
    expect((await patch({ icalImportUrl: "ftp://example.com/cal.ics" })).status).toBe(400);
    expect((await patch({ icalImportUrl: "http://localhost/cal.ics" })).status).toBe(400);
    expect(listingUpdate).not.toHaveBeenCalled();
  });
});
