export type ReviewableBooking = {
  status: string;
  checkOut: Date;
  review?: unknown | null;
  /** When given, a booking that was never paid for can't be reviewed, whatever its status says. */
  paymentStatus?: string;
};

/** A guest may review a stay once it's paid for, completed, and not already reviewed. */
export function canReviewBooking(booking: ReviewableBooking, now: Date = new Date()): boolean {
  return (
    (booking.status === "CONFIRMED" || booking.status === "COMPLETED") &&
    booking.checkOut <= now &&
    booking.paymentStatus !== "UNPAID" &&
    !booking.review
  );
}

/** Null when there are no reviews yet - never fabricated as 0. */
export function averageRating(reviews: { rating: number }[]): number | null {
  if (reviews.length === 0) return null;
  return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
}

/** Only the listing's own host may reply to a review left on it. */
export function canRespondToReview(params: {
  listingHostId: string;
  currentUserId: string;
}): boolean {
  return params.listingHostId === params.currentUserId;
}

/** A guest can report any review but their own, and at most once each. */
export function canReportReview(params: {
  reviewAuthorId: string;
  currentUserId: string;
  alreadyReported: boolean;
}): boolean {
  return params.reviewAuthorId !== params.currentUserId && !params.alreadyReported;
}

/**
 * An admin can only act on a report that's still awaiting a decision - one
 * already DISMISSED or ACTIONED has already had its outcome recorded, and
 * re-deciding it (rather than leaving that history alone) isn't a feature
 * this app offers.
 */
export function canActionReport(reportStatus: "OPEN" | "DISMISSED" | "ACTIONED"): boolean {
  return reportStatus === "OPEN";
}

export const REVIEW_CATEGORIES = [
  "cleanliness",
  "accuracy",
  "communication",
  "location",
  "value",
] as const;

export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

export const REVIEW_CATEGORY_LABEL: Record<ReviewCategory, string> = {
  cleanliness: "Cleanliness",
  accuracy: "Accuracy",
  communication: "Communication",
  location: "Location",
  value: "Value",
};

export type RatableReview = {
  rating: number;
  cleanlinessRating?: number | null;
  accuracyRating?: number | null;
  communicationRating?: number | null;
  locationRating?: number | null;
  valueRating?: number | null;
};

export type RatingBreakdown = {
  count: number;
  /** Null when there are no reviews yet - never fabricated as 0. */
  average: number | null;
  /** Count of reviews at each star value, 5 down to 1. */
  starCounts: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Each category's average, or null if no review rated that category. */
  categoryAverages: Record<ReviewCategory, number | null>;
};

const CATEGORY_FIELD: Record<ReviewCategory, keyof RatableReview> = {
  cleanliness: "cleanlinessRating",
  accuracy: "accuracyRating",
  communication: "communicationRating",
  location: "locationRating",
  value: "valueRating",
};

/**
 * The single source of truth for turning a listing's reviews into the
 * summary shown at the top of the property page (overall average, the
 * star-count breakdown) and the per-category averages shown alongside it.
 * A category average only counts reviews that actually rated that category,
 * never defaulting a missing rating to 0.
 */
export function computeRatingBreakdown(reviews: RatableReview[]): RatingBreakdown {
  const starCounts: RatingBreakdown["starCounts"] = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const review of reviews) {
    const rounded = Math.min(5, Math.max(1, Math.round(review.rating))) as 1 | 2 | 3 | 4 | 5;
    starCounts[rounded] += 1;
  }

  const average =
    reviews.length === 0
      ? null
      : reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

  const categoryAverages = Object.fromEntries(
    REVIEW_CATEGORIES.map((category) => {
      const field = CATEGORY_FIELD[category];
      const values = reviews
        .map((r) => r[field])
        .filter((v): v is number => typeof v === "number");
      const categoryAverage =
        values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
      return [category, categoryAverage];
    }),
  ) as Record<ReviewCategory, number | null>;

  return { count: reviews.length, average, starCounts, categoryAverages };
}
