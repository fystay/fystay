import type { PrismaClient } from "@prisma/client";
import type { InsightBooking, InsightListing } from "@/lib/hostInsights";

/**
 * One query shape for every hosting page (Today, Bookings, Calendar,
 * Earnings, Listings), so they all count the same bookings the same way.
 *
 * Bookings: every one a guest paid for (any status - a cancelled one may
 * still have earned the host part of its price), every confirmed stay, and
 * requests still awaiting the host. Never a checkout still in progress or
 * abandoned - those aren't stays until the guest pays.
 *
 * Narrow column selects throughout: a host's full history is read for the
 * all-time and best-month figures, so each row carries only what those
 * calculations and the booking cards need.
 */
export async function loadHostPortfolio(prisma: PrismaClient, hostId: string) {
  const [listings, bookings, reviews] = await Promise.all([
    prisma.listing.findMany({
      where: { hostId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        city: true,
        published: true,
        suspendedAt: true,
        photos: true,
        propertyType: true,
        pricePerNightCents: true,
        description: true,
        amenities: true,
        address: true,
        checkInTime: true,
        checkInInstructions: true,
        quietHoursStart: true,
        additionalRules: true,
        weeklyDiscountPercent: true,
        cleaningFeeCents: true,
        icalImportUrl: true,
        icalSyncedAt: true,
        instantBook: true,
        roomTypes: { select: { totalRooms: true } },
      },
    }),
    prisma.booking.findMany({
      where: {
        listing: { hostId },
        OR: [
          { paidAt: { not: null } },
          { paymentStatus: { not: "UNPAID" } },
          // Confirmed without a recorded payment time: made by support, or
          // from before paidAt existed. Still a real stay on the calendar.
          { status: { in: ["CONFIRMED", "COMPLETED"] } },
          { approvalStatus: "AWAITING", status: "PENDING" },
        ],
      },
      orderBy: { checkIn: "asc" },
      select: {
        id: true,
        reference: true,
        listingId: true,
        roomTypeId: true,
        status: true,
        approvalStatus: true,
        paymentStatus: true,
        paidAt: true,
        checkIn: true,
        checkOut: true,
        nights: true,
        guests: true,
        guestName: true,
        nightlyPriceCents: true,
        lengthOfStayDiscountCents: true,
        roomsBooked: true,
        createdAt: true,
        totalPriceCents: true,
        serviceFeeCents: true,
        taxCents: true,
        creditAppliedCents: true,
        promoDiscountCents: true,
        refundedAmountCents: true,
        refundedAt: true,
        requestExpiresAt: true,
        depositStatus: true,
        depositClaimDeadline: true,
        securityDepositCents: true,
      },
    }),
    prisma.review.findMany({
      where: { listing: { hostId }, status: "PUBLISHED" },
      select: { rating: true, listingId: true, hostResponse: true, createdAt: true, id: true },
    }),
  ]);

  const insightListings: (InsightListing & (typeof listings)[number])[] = listings.map((l) => ({
    ...l,
    units: l.roomTypes.length > 0 ? l.roomTypes.reduce((s, r) => s + r.totalRooms, 0) : 1,
  }));

  return {
    listings: insightListings,
    bookings: bookings.map((b) => ({ ...b, guestName: b.guestName ?? "Guest" })) satisfies InsightBooking[],
    reviews,
  };
}

export type HostPortfolio = Awaited<ReturnType<typeof loadHostPortfolio>>;
export type PortfolioBooking = HostPortfolio["bookings"][number];
export type PortfolioListing = HostPortfolio["listings"][number];
