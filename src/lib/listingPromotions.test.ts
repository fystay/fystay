import { describe, expect, it, vi } from "vitest";
import {
  activatePaidPromotion,
  findPromotionPlan,
  promotionIneligibilityReason,
  promotionPhase,
  promotionWindow,
  spotlightAvailability,
  SPOTLIGHT_SLOTS,
} from "./listingPromotions";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-05T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * DAY);

describe("findPromotionPlan", () => {
  it("returns the server-side plan for a known key and nothing for anything else", () => {
    expect(findPromotionPlan("WEEK")).toMatchObject({ days: 7, priceCents: 1500 });
    expect(findPromotionPlan("FREE")).toBeUndefined();
  });
});

describe("promotionWindow", () => {
  it("starts now when the listing has no paid placement still running", () => {
    expect(promotionWindow(now, 7, [])).toEqual({ startsAt: now, endsAt: days(7) });
    expect(promotionWindow(now, 7, [days(-3), null])).toEqual({ startsAt: now, endsAt: days(7) });
  });

  it("starts when the listing's latest placement ends, so buying again extends it", () => {
    expect(promotionWindow(now, 14, [days(2), days(5)])).toEqual({ startsAt: days(5), endsAt: days(19) });
  });
});

describe("promotionPhase", () => {
  const paid = (startsAt: Date, endsAt: Date) => ({ status: "PAID" as const, startsAt, endsAt });

  it("derives live, scheduled and finished from the dates", () => {
    expect(promotionPhase(paid(days(-1), days(6)), now)).toBe("live");
    expect(promotionPhase(paid(days(1), days(8)), now)).toBe("scheduled");
    expect(promotionPhase(paid(days(-8), days(-1)), now)).toBe("finished");
    expect(promotionPhase(paid(days(-7), now), now)).toBe("finished");
  });

  it("reports unpaid and abandoned placements as such", () => {
    expect(promotionPhase({ status: "PENDING_PAYMENT", startsAt: null, endsAt: null }, now)).toBe("pending");
    expect(promotionPhase({ status: "CANCELLED", startsAt: null, endsAt: null }, now)).toBe("cancelled");
  });
});

describe("promotionIneligibilityReason", () => {
  const listing = { published: true, suspendedAt: null };

  it("allows a published listing whose host can take payments", () => {
    expect(promotionIneligibilityReason(listing, true)).toBeNull();
  });

  it("refuses suspended, unpublished, and not-yet-payable listings", () => {
    expect(promotionIneligibilityReason({ published: true, suspendedAt: now }, true)).toMatch(/suspended/);
    expect(promotionIneligibilityReason({ published: false, suspendedAt: null }, true)).toMatch(/Publish/);
    expect(promotionIneligibilityReason(listing, false)).toMatch(/payouts/);
  });
});

describe("spotlightAvailability", () => {
  const dbWith = (rows: { listingId: string; endsAt: Date | null }[]) => {
    const findMany = vi.fn(async () => rows);
    return { db: { listingPromotion: { findMany } } as never, findMany };
  };
  const window = { startsAt: now, endsAt: days(7) };

  it("has room while fewer than SPOTLIGHT_SLOTS other listings overlap the window", async () => {
    const rows = Array.from({ length: SPOTLIGHT_SLOTS - 1 }, (_, i) => ({ listingId: `l${i}`, endsAt: days(3) }));
    const { db, findMany } = dbWith(rows);
    await expect(spotlightAvailability(db, window, "mine")).resolves.toEqual({ available: true, nextFreeAt: null });
    // Only other listings' paid placements overlapping the window are counted.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PAID", listingId: { not: "mine" } }),
      }),
    );
  });

  it("counts a listing with two stacked placements once, and reports when the first spot frees up", async () => {
    const rows = Array.from({ length: SPOTLIGHT_SLOTS }, (_, i) => ({ listingId: `l${i}`, endsAt: days(4 + i) }));
    rows.push({ listingId: "l0", endsAt: days(10) });
    const { db } = dbWith(rows);
    await expect(spotlightAvailability(db, window, "mine")).resolves.toEqual({
      available: false,
      nextFreeAt: days(5),
    });
  });
});

describe("activatePaidPromotion", () => {
  function fakeDb(promotion: { status: string } | null, existingEnds: (Date | null)[], updated = 1) {
    const updateMany = vi.fn(async () => ({ count: updated }));
    const executeRaw = vi.fn(async () => 0);
    const tx = {
      $executeRaw: executeRaw,
      listingPromotion: {
        findUnique: async () => (promotion ? { id: "p1", listingId: "l1", hostId: "h1", days: 7, ...promotion } : null),
        findMany: async () => existingEnds.map((endsAt) => ({ endsAt })),
        updateMany,
      },
    };
    const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } as never;
    return { db, updateMany, executeRaw };
  }

  it("marks an unpaid placement paid with dates that follow the listing's current placement", async () => {
    const { db, updateMany } = fakeDb({ status: "PENDING_PAYMENT" }, [days(3)]);
    const result = await activatePaidPromotion(db, "p1", "pi_1", now);
    expect(result).toEqual({ id: "p1", listingId: "l1", hostId: "h1", startsAt: days(3), endsAt: days(10) });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "PENDING_PAYMENT" },
      data: { status: "PAID", paidAt: now, startsAt: days(3), endsAt: days(10), stripePaymentIntentId: "pi_1" },
    });
  });

  it("works out the dates under a per-listing lock, so two payments landing together can't take the same days", async () => {
    const { db, executeRaw } = fakeDb({ status: "PENDING_PAYMENT" }, []);
    await activatePaidPromotion(db, "p1", null, now);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(executeRaw.mock.calls[0].slice(1)).toEqual(["promotion:l1"]);
  });

  it("does nothing for a placement that's already paid (a redelivered webhook)", async () => {
    const { db, updateMany } = fakeDb({ status: "PAID" }, []);
    await expect(activatePaidPromotion(db, "p1", "pi_1", now)).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when a concurrent activation got there first", async () => {
    const { db } = fakeDb({ status: "PENDING_PAYMENT" }, [], 0);
    await expect(activatePaidPromotion(db, "p1", null, now)).resolves.toBeNull();
  });
});
