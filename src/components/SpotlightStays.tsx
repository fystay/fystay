import { randomInt } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { liveSpotlightWhere, SPOTLIGHT_SLOTS } from "@/lib/listingPromotions";
import { rankByPopularity } from "@/lib/marketplace";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { EditorialHeader } from "@/components/EditorialHeader";
import { LargeCardRail } from "@/components/LargeCardRail";
import { ListingCard } from "@/components/ListingCard";
import { SpotlightTracker } from "@/components/SpotlightTracker";
import { ComingSoonStayCard } from "@/components/ComingSoonStayCard";

/** The towns whose "Coming soon" cards hold the row before any stay is live (owner's choice). */
const COMING_SOON_TOWNS = ["blackpool", "lytham", "thornton-cleveleys", "fleetwood"];

/** How many stays the carousel holds at most. */
const MAX_STAYS = 10;

const LISTING_SELECT = {
  id: true,
  title: true,
  city: true,
  country: true,
  propertyType: true,
  pricePerNightCents: true,
  weeklyDiscountPercent: true,
  monthlyDiscountPercent: true,
  photos: true,
  amenities: true,
  maxGuests: true,
  bedrooms: true,
  createdAt: true,
  lastMinuteDiscountPercent: true,
  lastMinuteWindowDays: true,
  priceDropFromCents: true,
  priceDroppedAt: true,
  reviews: { where: { status: "PUBLISHED" as const }, select: { rating: true } },
};

/** Rotated so a random paid placement leads on each page view - every paying host gets turns at the front. */
function rotate<T>(items: T[]): T[] {
  if (items.length < 2) return items;
  const start = randomInt(items.length);
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * The homepage's main carousel, directly under the search: live Spotlight
 * placements first (paid - each card labelled "Promoted", as UK rules on
 * paid placement require, with its views and clicks counted for the host),
 * then the most popular real stays (see rankByPopularity). Only real,
 * published, bookable stays with their real prices and verified reviews.
 * Before any stay is live, clearly-labelled "Coming soon" town cards hold
 * the row - never an invented property.
 */
export async function SpotlightStays() {
  const now = new Date();
  const [session, promotions, listings] = await Promise.all([
    auth().catch(() => null),
    prisma.listingPromotion
      .findMany({
        where: { ...liveSpotlightWhere(now), AND: [{ listing: bookableHostWhere() }] },
        orderBy: { startsAt: "asc" },
        distinct: ["listingId"],
        take: SPOTLIGHT_SLOTS,
        select: { id: true, listing: { select: LISTING_SELECT } },
      })
      .catch((error: unknown) => {
        console.error("Couldn't load Spotlight placements", error);
        Sentry.captureException(error);
        return [];
      }),
    prisma.listing
      .findMany({ where: { published: true, suspendedAt: null, ...bookableHostWhere() }, select: LISTING_SELECT })
      .catch((error: unknown) => {
        console.error("Couldn't load the homepage's stays", error);
        Sentry.captureException(error);
        return [];
      }),
  ]);

  const promoted = rotate(promotions);
  const promotedIds = new Set(promoted.map((promotion) => promotion.listing.id));
  // Stays with photos lead (in popularity order), so the row opens on real
  // photography; a stay without one still appears, after them.
  const ranked = rankByPopularity(listings);
  const popular = [...ranked.filter((l) => l.photos.length > 0), ...ranked.filter((l) => l.photos.length === 0)]
    .filter((listing) => !promotedIds.has(listing.id))
    .slice(0, Math.max(0, MAX_STAYS - promoted.length));
  const shownIds = [...promotedIds, ...popular.map((listing) => listing.id)];

  const savedListingIds =
    session?.user && shownIds.length > 0
      ? new Set(
          (
            await prisma.savedListing
              .findMany({ where: { userId: session.user.id, listingId: { in: shownIds } }, select: { listingId: true } })
              .catch(() => [])
          ).map((saved) => saved.listingId),
        )
      : new Set<string>();
  const isLoggedIn = Boolean(session?.user);
  const empty = shownIds.length === 0;

  return (
    <section className="mt-10 sm:mt-14" aria-labelledby="spotlight-heading">
      <EditorialHeader
        id="spotlight-heading"
        eyebrow="Spotlight stays"
        title="Stays worth the trip"
        subtitle={
          empty
            ? "The first stays from local hosts are on their way."
            : promoted.length > 0
              ? "Guests' favourites from local hosts. Stays marked Promoted are featured by their hosts."
              : "Guests' favourites from local hosts across the Fylde Coast."
        }
        link={empty ? undefined : { href: "/search", label: "View all" }}
      />
      <LargeCardRail label="Spotlight stays">
        {empty
          ? FYLDE_COAST_DESTINATIONS.filter((destination) => COMING_SOON_TOWNS.includes(destination.slug))
              .sort((a, b) => COMING_SOON_TOWNS.indexOf(a.slug) - COMING_SOON_TOWNS.indexOf(b.slug))
              .map((destination) => (
              <ComingSoonStayCard key={destination.slug} destination={destination} />
            ))
          : [
              ...promoted.map(({ id, listing }) => (
                <SpotlightTracker key={listing.id} promotionId={id}>
                  <ListingCard
                    listing={listing}
                    isSaved={savedListingIds.has(listing.id)}
                    isLoggedIn={isLoggedIn}
                    size="large"
                    promoted
                    cta="View stay"
                  />
                </SpotlightTracker>
              )),
              ...popular.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isSaved={savedListingIds.has(listing.id)}
                  isLoggedIn={isLoggedIn}
                  size="large"
                  cta="View stay"
                />
              )),
            ]}
      </LargeCardRail>
    </section>
  );
}
