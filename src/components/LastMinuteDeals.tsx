import { BadgePercent } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { blockingBookingWhere, blockingRanges, blocksForRoomType, isRangeAvailable, isRoomTypeRangeAvailable } from "@/lib/availability";
import { activePriceDrop, hasLastMinuteDeal, possibleDealWhere } from "@/lib/deals";
import { todayStayDate } from "@/lib/stayDates";
import { LargeCardRail } from "@/components/LargeCardRail";
import { ListingCard } from "@/components/ListingCard";
import { HomeSectionEmpty } from "@/components/HomeSectionEmpty";

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
 */
export async function LastMinuteDeals() {
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
    .slice(0, MAX_DEALS);

  if (deals.length === 0) {
    return (
      <LastMinuteDealsSection>
        <HomeSectionEmpty
          message="No last-minute deals today. Deals from local hosts show here as soon as they're added."
          link={{ href: "/search", label: "Browse all stays" }}
        />
      </LastMinuteDealsSection>
    );
  }

  const savedListingIds = session?.user
    ? new Set(
        (
          await prisma.savedListing.findMany({
            where: { userId: session.user.id, listingId: { in: deals.map((d) => d.card.id) } },
            select: { listingId: true },
          }).catch(() => [])
        ).map((saved) => saved.listingId),
      )
    : new Set<string>();

  return (
    <LastMinuteDealsSection>
      <LargeCardRail label="Last Minute Deals">
        {deals.map(({ card }) => (
          <ListingCard
            key={card.id}
            listing={card}
            isSaved={savedListingIds.has(card.id)}
            isLoggedIn={Boolean(session?.user)}
            size="large"
            showLastMinutePrice
          />
        ))}
      </LargeCardRail>
    </LastMinuteDealsSection>
  );
}

function LastMinuteDealsSection({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-10 sm:mt-14" aria-labelledby="last-minute-deals-heading">
      <div className="mb-5 sm:mb-6">
        <h2 id="last-minute-deals-heading" className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
          <BadgePercent className="h-5 w-5 text-brand-600" aria-hidden />
          Last Minute Deals
        </h2>
        <p className="mt-1 text-sm text-stone-500">Stays coming up soon for less, plus genuine price drops from local hosts.</p>
      </div>
      {children}
    </section>
  );
}
