import { describe, expect, it } from "vitest";
import {
  averageRating,
  canActionReport,
  canReportReview,
  canReviewBooking,
  canRespondToReview,
  computeRatingBreakdown,
} from "./reviews";

describe("averageRating", () => {
  it("returns null for no reviews, never a fabricated 0", () => {
    expect(averageRating([])).toBeNull();
  });

  it("averages the ratings given", () => {
    expect(averageRating([{ rating: 5 }, { rating: 3 }])).toBe(4);
  });
});

const now = new Date("2026-06-15");

describe("canReviewBooking", () => {
  it("allows a completed, confirmed, unreviewed booking", () => {
    expect(
      canReviewBooking({ status: "CONFIRMED", checkOut: new Date("2026-06-10") }, now),
    ).toBe(true);
  });

  it("rejects a booking that hasn't checked out yet", () => {
    expect(
      canReviewBooking({ status: "CONFIRMED", checkOut: new Date("2026-06-20") }, now),
    ).toBe(false);
  });

  it("rejects a PENDING booking", () => {
    expect(
      canReviewBooking({ status: "PENDING", checkOut: new Date("2026-06-10") }, now),
    ).toBe(false);
  });

  it("rejects a CANCELLED booking", () => {
    expect(
      canReviewBooking({ status: "CANCELLED", checkOut: new Date("2026-06-10") }, now),
    ).toBe(false);
  });

  it("rejects a booking that was never paid for, whatever its status says", () => {
    expect(
      canReviewBooking({ status: "CONFIRMED", checkOut: new Date("2026-06-10"), paymentStatus: "UNPAID" }, now),
    ).toBe(false);
    expect(
      canReviewBooking({ status: "COMPLETED", checkOut: new Date("2026-06-10"), paymentStatus: "PAID" }, now),
    ).toBe(true);
  });

  it("rejects a booking that already has a review", () => {
    expect(
      canReviewBooking(
        { status: "CONFIRMED", checkOut: new Date("2026-06-10"), review: { id: "r1" } },
        now,
      ),
    ).toBe(false);
  });

  it("allows a booking checking out exactly now", () => {
    expect(canReviewBooking({ status: "CONFIRMED", checkOut: now }, now)).toBe(true);
  });
});

describe("canRespondToReview", () => {
  it("allows only the listing's own host to respond", () => {
    expect(canRespondToReview({ listingHostId: "host1", currentUserId: "host1" })).toBe(true);
    expect(canRespondToReview({ listingHostId: "host1", currentUserId: "guest1" })).toBe(false);
  });
});

describe("canReportReview", () => {
  it("allows a guest to report someone else's review once", () => {
    expect(
      canReportReview({
        reviewAuthorId: "guest1",
        currentUserId: "guest2",
        alreadyReported: false,
      }),
    ).toBe(true);
  });

  it("rejects reporting your own review", () => {
    expect(
      canReportReview({
        reviewAuthorId: "guest1",
        currentUserId: "guest1",
        alreadyReported: false,
      }),
    ).toBe(false);
  });

  it("rejects a second report from the same guest", () => {
    expect(
      canReportReview({
        reviewAuthorId: "guest1",
        currentUserId: "guest2",
        alreadyReported: true,
      }),
    ).toBe(false);
  });
});

describe("canActionReport", () => {
  it("allows acting on an OPEN report", () => {
    expect(canActionReport("OPEN")).toBe(true);
  });

  it("rejects a report that's already been dismissed", () => {
    expect(canActionReport("DISMISSED")).toBe(false);
  });

  it("rejects a report that's already been actioned", () => {
    expect(canActionReport("ACTIONED")).toBe(false);
  });
});

describe("computeRatingBreakdown", () => {
  it("reports a null average and no category scores when there are no reviews", () => {
    expect(computeRatingBreakdown([])).toEqual({
      count: 0,
      average: null,
      starCounts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      categoryAverages: {
        cleanliness: null,
        accuracy: null,
        communication: null,
        location: null,
        value: null,
      },
    });
  });

  it("computes the overall average and the per-star breakdown", () => {
    const breakdown = computeRatingBreakdown([
      { rating: 5 },
      { rating: 5 },
      { rating: 4 },
      { rating: 3 },
    ]);
    expect(breakdown.count).toBe(4);
    expect(breakdown.average).toBeCloseTo(4.25);
    expect(breakdown.starCounts).toEqual({ 5: 2, 4: 1, 3: 1, 2: 0, 1: 0 });
  });

  it("averages each category only over the reviews that actually rated it", () => {
    const breakdown = computeRatingBreakdown([
      { rating: 5, cleanlinessRating: 5, locationRating: 4 },
      { rating: 4, cleanlinessRating: 3 },
      { rating: 3 },
    ]);
    expect(breakdown.categoryAverages.cleanliness).toBeCloseTo(4);
    expect(breakdown.categoryAverages.location).toBe(4);
    expect(breakdown.categoryAverages.accuracy).toBeNull();
  });
});
