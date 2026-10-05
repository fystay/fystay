import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Paid featuring ("Spotlight stays"): a host pays FYStay to feature one of
 * their listings in the homepage's Spotlight row for a fixed number of days.
 * It's FYStay's own advertising product, so it's a plain platform charge
 * (like a Trip Extra), never a Connect payment to the host.
 *
 * A placement is live while status is PAID and startsAt <= now < endsAt -
 * derived from the dates, so nothing has to run for one to expire. Buying
 * again for a listing that's already featured extends it: the new placement
 * starts when that listing's latest paid one ends.
 *
 * Because hosts pay for the spot, the homepage labels every card in the row
 * "Promoted" and says so under the heading (UK consumer law requires paid
 * placement to be identifiable as such).
 */

/** How many listings can be in the Spotlight row at once - scarcity is what makes a spot worth paying for. */
export const SPOTLIGHT_SLOTS = 8;

/**
 * What a host can buy. Prices are what the host is charged, in pence. A
 * placement snapshots its plan's days and price when it's created, so
 * changing a price here never rewrites what an earlier host paid.
 */
export const PROMOTION_PLANS = [
  { key: "WEEK", label: "7 days", days: 7, priceCents: 1500 },
  { key: "FORTNIGHT", label: "14 days", days: 14, priceCents: 2500 },
  { key: "MONTH", label: "30 days", days: 30, priceCents: 4500 },
] as const;

export type PromotionPlan = (typeof PROMOTION_PLANS)[number];
export type PromotionPlanKey = PromotionPlan["key"];

export const PROMOTION_PLAN_KEYS = PROMOTION_PLANS.map((plan) => plan.key) as [
  PromotionPlanKey,
  ...PromotionPlanKey[],
];

export function findPromotionPlan(key: string): PromotionPlan | undefined {
  return PROMOTION_PLANS.find((plan) => plan.key === key);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a new placement of `days` days would run: from now, or straight after
 * the latest end among this listing's existing paid placements if that's
 * later - so a second purchase extends the first rather than overlapping it.
 */
export function promotionWindow(
  now: Date,
  days: number,
  existingEnds: (Date | null)[],
): { startsAt: Date; endsAt: Date } {
  const latestEnd = existingEnds.reduce<number>(
    (latest, end) => (end && end.getTime() > latest ? end.getTime() : latest),
    now.getTime(),
  );
  const startsAt = new Date(latestEnd);
  return { startsAt, endsAt: new Date(startsAt.getTime() + days * DAY_MS) };
}

/** Placements showing in the Spotlight row right now: paid, inside their dates, on a listing guests can see. */
export function liveSpotlightWhere(now: Date): Prisma.ListingPromotionWhereInput {
  return {
    status: "PAID",
    startsAt: { lte: now },
    endsAt: { gt: now },
    listing: { published: true, suspendedAt: null },
  };
}

export type PromotionPhase = "pending" | "cancelled" | "scheduled" | "live" | "finished";

export function promotionPhase(
  promotion: { status: "PENDING_PAYMENT" | "PAID" | "CANCELLED"; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): PromotionPhase {
  if (promotion.status === "PENDING_PAYMENT") return "pending";
  if (promotion.status === "CANCELLED" || !promotion.startsAt || !promotion.endsAt) return "cancelled";
  if (promotion.endsAt <= now) return "finished";
  if (promotion.startsAt > now) return "scheduled";
  return "live";
}

/**
 * Why a listing can't be featured right now, or null if it can. A guest who
 * finds a Spotlight listing has to be able to book it, so it must be
 * published, not suspended, and its host must be able to take payments
 * (finished Stripe payout setup) - otherwise the host would be paying for
 * views that can never turn into bookings.
 */
export function promotionIneligibilityReason(
  listing: { published: boolean; suspendedAt: Date | null },
  hostAcceptsPaidBookings: boolean,
): string | null {
  if (listing.suspendedAt) return "This listing is suspended, so it can't be featured.";
  if (!listing.published) return "Publish this listing before featuring it.";
  if (!hostAcceptsPaidBookings) {
    return "Finish setting up payouts first, so guests who find this listing can book it.";
  }
  return null;
}

type Db = Pick<PrismaClient, "listingPromotion">;

/**
 * Whether there's a free Spotlight spot for the whole of `window`, counting
 * other listings' paid placements that overlap it (this listing's own never
 * count against it - extending a placement doesn't need a second spot).
 * When it's full, nextFreeAt is the soonest any of those placements ends.
 *
 * A checkout that hasn't been paid doesn't hold a spot, so two hosts paying
 * for the last spot at the same moment can both get it - the row briefly
 * shows one extra listing, which is a better outcome than charging someone
 * for a spot they then can't have.
 */
export async function spotlightAvailability(
  db: Db,
  window: { startsAt: Date; endsAt: Date },
  listingId: string,
): Promise<{ available: boolean; nextFreeAt: Date | null }> {
  const overlapping = await db.listingPromotion.findMany({
    where: {
      status: "PAID",
      listingId: { not: listingId },
      startsAt: { lt: window.endsAt },
      endsAt: { gt: window.startsAt },
    },
    select: { listingId: true, endsAt: true },
  });
  const latestEndByListing = new Map<string, number>();
  for (const { listingId: id, endsAt } of overlapping) {
    if (!endsAt) continue;
    latestEndByListing.set(id, Math.max(latestEndByListing.get(id) ?? 0, endsAt.getTime()));
  }
  if (latestEndByListing.size < SPOTLIGHT_SLOTS) return { available: true, nextFreeAt: null };
  return { available: false, nextFreeAt: new Date(Math.min(...latestEndByListing.values())) };
}

/**
 * Marks a placement paid and gives it its dates, from the moment payment
 * lands. Only ever moves a PENDING_PAYMENT placement, so a redelivered
 * webhook (or a webhook racing the dev-mode path) is a no-op. Returns the
 * activated placement, or null when there was nothing to activate.
 */
export async function activatePaidPromotion(
  db: PrismaClient,
  promotionId: string,
  paymentIntentId: string | null,
  now: Date = new Date(),
): Promise<{ id: string; listingId: string; hostId: string; startsAt: Date; endsAt: Date } | null> {
  return db.$transaction(async (tx) => {
    const promotion = await tx.listingPromotion.findUnique({ where: { id: promotionId } });
    if (!promotion || promotion.status !== "PENDING_PAYMENT") return null;

    const existing = await tx.listingPromotion.findMany({
      where: { listingId: promotion.listingId, status: "PAID" },
      select: { endsAt: true },
    });
    const { startsAt, endsAt } = promotionWindow(now, promotion.days, existing.map((p) => p.endsAt));

    const { count } = await tx.listingPromotion.updateMany({
      where: { id: promotionId, status: "PENDING_PAYMENT" },
      data: {
        status: "PAID",
        paidAt: now,
        startsAt,
        endsAt,
        ...(paymentIntentId && { stripePaymentIntentId: paymentIntentId }),
      },
    });
    if (count === 0) return null;
    return { id: promotion.id, listingId: promotion.listingId, hostId: promotion.hostId, startsAt, endsAt };
  });
}
