import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { blockingBookingWhere, blockingRanges, blocksForRoomType, isRangeAvailable, isRoomTypeRangeAvailable } from "@/lib/availability";
import { activePriceDrop, hasLastMinuteDeal, possibleDealWhere } from "@/lib/deals";
import { todayStayDate } from "@/lib/stayDates";
import { LargeCardRail } from "@/components/LargeCardRail";
import { ListingCard } from "@/components/ListingCard";
import { EditorialHeader } from "@/components/EditorialHeader";

const MAX_DEALS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The homepage's "Last Minute Deals" row: stays with a genuine deal right now (see
 * src/lib/deals.ts) - a last-minute deal with at least one night still free
 * inside its window, or a live price drop - biggest saving first. A
 * last-minute deal with nothing left to book in its window isn't a deal
 * anyone can take, so it doesn't count. With no deals (or on an error,
 * which never fails the page), the heading still shows, with a note in
 * place of the stays.
 *
 * loadLastMinuteDeals: every stay with a genuine deal right now, biggest
 * saving first (at most `limit`), each as the card should show it - shared
 * by the homepage row and the full /deals page.
 */
export async function loadLastMinuteDeals(limit?: number) {
  const now = new Date();
  const today = todayStayDate(now);

  const [session, listings] = await Promise.all([
    auth().catch(() => null),
    prisma.listing
      .findMany({
        where: { published: true, suspendedAt: null, ...bookableHostWhere(), ...possibleDealWhere(now) },
        include: {
          reviews: { where: { status: "PUBLISHED" }, select: { rating: true } },
          bookings: { where: blockingBookingWhere(now), select: { checkIn: true, checkOut: true } },
          availabilityBlocks: { select: { startDate: true, endDate: true, roomTypeId: true } },
          roomTypes: {
            select: {
              totalRooms: true,
              bookings: {
                where: blockingBookingWhere(now),
                select: { checkIn: true, checkOut: true, roomsBooked: true },
              },
              availabilityBlocks: { select: { startDate: true, endDate: true } },
            },
          },
        },
      })
      .catch((error: unknown) => {
        console.error("Couldn't load Last Minute Deals", error);
        Sentry.captureException(error);
        return [];
      }),
  ]);

  const deals = listings
    .map((listing) => {
      const freeNightSoon =
        hasLastMinuteDeal(listing) &&
        Array.from({ length: listing.lastMinuteWindowDays! + 1 }, (_, i) => new Date(today.getTime() + i * DAY_MS)).some(
          (night) => {
            const nextDay = new Date(night.getTime() + DAY_MS);
            return listing.propertyType === "HOTEL"
              ? listing.roomTypes.some((roomType) =>
                  isRoomTypeRangeAvailable(night, nextDay, 1, roomType.totalRooms, roomType.bookings, blocksForRoomType(roomType.availabilityBlocks, listing.availabilityBlocks)),
                )
              : isRangeAvailable(night, nextDay, blockingRanges(listing.bookings, listing.availabilityBlocks));
          },
        );
      const drop = activePriceDrop(listing, now);
      const saving = Math.max(freeNightSoon ? listing.lastMinuteDiscountPercent! : 0, drop?.percentOff ?? 0);
      return {
        // A last-minute deal with nothing free in its window isn't offered
        // on the card either.
        card: freeNightSoon ? listing : { ...listing, lastMinuteDiscountPercent: null, lastMinuteWindowDays: null },
        saving,
      };
    })
    .filter((deal) => deal.saving > 0)
    .sort((a, b) => b.saving - a.saving)
    .slice(0, limit);

  const savedListingIds = session?.user && deals.length > 0
    ? new Set(
        (
          await prisma.savedListing.findMany({
            where: { userId: session.user.id, listingId: { in: deals.map((d) => d.card.id) } },
            select: { listingId: true },
          }).catch(() => [])
        ).map((saved) => saved.listingId),
      )
    : new Set<string>();

  return { deals: deals.map((deal) => deal.card), savedListingIds, isLoggedIn: Boolean(session?.user) };
}

export async function LastMinuteDeals() {
  const { deals, savedListingIds, isLoggedIn } = await loadLastMinuteDeals(MAX_DEALS);

  // No deals means no section - never a row of "coming soon" placeholders.
  if (deals.length === 0) return null;

  return (
    <LastMinuteDealsSection>
      <LargeCardRail label="Last Minute Deals stays">
        {deals.map((card) => (
          <ListingCard
            key={card.id}
            listing={card}
            isSaved={savedListingIds.has(card.id)}
            isLoggedIn={isLoggedIn}
            size="large"
            showLastMinutePrice
            cta="View deal"
            frame="editorial"
          />
        ))}
      </LargeCardRail>
    </LastMinuteDealsSection>
  );
}

function LastMinuteDealsSection({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-12 sm:mt-16" aria-labelledby="last-minute-deals-heading">
      <EditorialHeader
        id="last-minute-deals-heading"
        name="Last-minute deals"
        link={{ href: "/deals", label: "View all" }}
      />
      {children}
    </section>
  );
}
