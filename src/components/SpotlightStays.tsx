import { randomInt } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { liveSpotlightWhere, SPOTLIGHT_SLOTS } from "@/lib/listingPromotions";
import { averageRating } from "@/lib/reviews";
import { SpotlightShowcase, type SpotlightSlide } from "@/components/SpotlightShowcase";

/** Which placement opens the showcase on this page view - at random, so every paying host gets turns at the front. */
function spotlightStartIndex(count: number): number {
  return count > 1 ? randomInt(count) : 0;
}

/**
 * The homepage's "Spotlight stays": listings whose hosts have paid for a
 * live Spotlight placement (see src/lib/listingPromotions.ts), longest-
 * running first, shown one at a time in SpotlightShowcase. Every stay is
 * labelled "Promoted" and the heading says the spots are paid for, so paid
 * placement is never passed off as FYStay's own pick. Renders nothing when
 * no placement is live - the section only exists while hosts are actually
 * paying for it.
 */
export async function SpotlightStays() {
  const now = new Date();
  const [session, promotions] = await Promise.all([
    auth(),
    // An optional row must never take the homepage down with it: if the
    // placements can't be read (a database not yet migrated, an outage),
    // the row is simply left out and the error reported.
    prisma.listingPromotion
      .findMany({
        where: { ...liveSpotlightWhere(now), AND: [{ listing: bookableHostWhere() }] },
        orderBy: { startsAt: "asc" },
        distinct: ["listingId"],
        take: SPOTLIGHT_SLOTS,
        select: {
          id: true,
          listing: {
            select: {
              id: true,
              title: true,
              city: true,
              pricePerNightCents: true,
              photos: true,
              maxGuests: true,
              bedrooms: true,
              reviews: { where: { status: "PUBLISHED" }, select: { rating: true } },
            },
          },
        },
      })
      .catch((error: unknown) => {
        console.error("Couldn't load Spotlight placements", error);
        Sentry.captureException(error);
        return [];
      }),
  ]);
  if (promotions.length === 0) return null;

  const savedListingIds = session?.user
    ? new Set(
        (
          await prisma.savedListing.findMany({
            where: { userId: session.user.id, listingId: { in: promotions.map((p) => p.listing.id) } },
            select: { listingId: true },
          })
        ).map((saved) => saved.listingId),
      )
    : new Set<string>();

  const slides: SpotlightSlide[] = promotions.map(({ id, listing }) => ({
    promotionId: id,
    listingId: listing.id,
    title: listing.title,
    city: listing.city,
    photo: listing.photos[0] ?? null,
    pricePerNightCents: listing.pricePerNightCents,
    rating: averageRating(listing.reviews),
    reviewCount: listing.reviews.length,
    bedrooms: listing.bedrooms,
    maxGuests: listing.maxGuests,
  }));

  return (
    <SpotlightShowcase
      slides={slides}
      startIndex={spotlightStartIndex(slides.length)}
      savedListingIds={[...savedListingIds]}
      isLoggedIn={Boolean(session?.user)}
    />
  );
}
