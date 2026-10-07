import { describe, expect, it } from "vitest";
import { buildActionItems, countReviewsAwaitingReply } from "./hostAttention";

const now = new Date("2026-10-15T12:00:00Z");
const base = {
  now,
  payoutsReady: true,
  hasListings: true,
  requests: [],
  changeRequests: 0,
  depositsToSettle: [],
  unreadMessages: 0,
  listings: [],
  reviewsAwaitingReply: 0,
  formatDeadline: (d: Date) => d.toISOString().slice(0, 10),
};
const listing = {
  id: "l1",
  title: "Seaside flat",
  published: true,
  suspendedAt: null,
  icalImportUrl: null,
  icalSyncedAt: null,
  healthScore: 100,
};

describe("buildActionItems", () => {
  it("is empty for a host with nothing waiting", () => {
    expect(buildActionItems({ ...base, listings: [listing] })).toEqual([]);
  });

  it("puts urgent things first, soonest deadline first", () => {
    const items = buildActionItems({
      ...base,
      unreadMessages: 2,
      requests: [
        { id: "b2", guestName: "Sam", listingTitle: "Flat", requestExpiresAt: new Date("2026-10-16T09:00:00Z") },
        { id: "b1", guestName: "Ana", listingTitle: "Flat", requestExpiresAt: new Date("2026-10-15T18:00:00Z") },
      ],
      listings: [{ ...listing, published: false }],
    });
    expect(items.map((i) => i.key)).toEqual(["request-b1", "request-b2", "messages", "unpublished"]);
    expect(items[0]).toMatchObject({ tone: "urgent", href: "/host/bookings/b1", title: "Ana wants to book" });
  });

  it("flags payouts only when there's a listing to book", () => {
    expect(buildActionItems({ ...base, payoutsReady: false, hasListings: false })).toEqual([]);
    expect(buildActionItems({ ...base, payoutsReady: false })[0].key).toBe("payouts");
  });

  it("warns when a calendar sync is more than two days old", () => {
    const stale = { ...listing, icalImportUrl: "https://x/ics", icalSyncedAt: new Date("2026-10-12T00:00:00Z") };
    const fresh = { ...stale, id: "l2", icalSyncedAt: new Date("2026-10-15T06:00:00Z") };
    expect(buildActionItems({ ...base, listings: [stale, fresh] }).map((i) => i.key)).toEqual(["ical-l1"]);
  });

  it("nudges a thin listing, but not one that's hidden or paused", () => {
    const items = buildActionItems({
      ...base,
      listings: [
        { ...listing, healthScore: 40 },
        { ...listing, id: "l2", healthScore: 40, suspendedAt: now },
      ],
    });
    expect(items.map((i) => i.key)).toEqual(["suspended-l2", "health"]);
    expect(items[1]).toMatchObject({ title: "Finish Seaside flat", href: "/host/listings/l1/edit" });
  });

  it("groups suggestions for many listings into one line", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...listing, id: `l${i}`, healthScore: 10 }));
    const items = buildActionItems({ ...base, listings: many });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "20 listings could use more detail", href: "/host/listings" });
  });
});

describe("countReviewsAwaitingReply", () => {
  it("counts recent unanswered reviews only", () => {
    expect(
      countReviewsAwaitingReply(
        [
          { hostResponse: null, createdAt: new Date("2026-10-10T00:00:00Z") },
          { hostResponse: "Thanks!", createdAt: new Date("2026-10-10T00:00:00Z") },
          { hostResponse: null, createdAt: new Date("2026-08-01T00:00:00Z") },
        ],
        now,
      ),
    ).toBe(1);
  });
});
