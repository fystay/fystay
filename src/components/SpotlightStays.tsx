import { Sparkles } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { liveSpotlightWhere, SPOTLIGHT_SLOTS } from "@/lib/listingPromotions";
import { LargeCardRail } from "@/components/LargeCardRail";
import { ListingCard } from "@/components/ListingCard";

/**
 * The homepage's "Spotlight stays" row: listings whose hosts have paid for a
 * live Spotlight placement (see src/lib/listingPromotions.ts), longest-
 * running first. Every card is labelled "Promoted" and the heading says the
 * spots are paid for, so paid placement is never passed off as FYStay's own
 * pick. Renders nothing when no placement is live - the row only exists
 * while hosts are actually paying for it.
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
        where: liveSpotlightWhere(now),
        orderBy: { startsAt: "asc" },
        distinct: ["listingId"],
        take: SPOTLIGHT_SLOTS,
        select: {
          listing: {
            select: {
              id: true,
              title: true,
              city: true,
              country: true,
              pricePerNightCents: true,
              cleaningFeeCents: true,
              weeklyDiscountPercent: true,
              monthlyDiscountPercent: true,
              photos: true,
              amenities: true,
              maxGuests: true,
              bedrooms: true,
              latitude: true,
              longitude: true,
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

  return (
    <section className="mt-10 sm:mt-14" aria-labelledby="spotlight-heading">
      <div className="mb-5 sm:mb-6">
        <h2 id="spotlight-heading" className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
          <Sparkles className="h-5 w-5 text-brand-600" aria-hidden />
          Spotlight stays
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Featured by local hosts, who pay for these spots.
        </p>
      </div>
      <LargeCardRail label="Spotlight stays">
        {promotions.map(({ listing }) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            isSaved={savedListingIds.has(listing.id)}
            isLoggedIn={Boolean(session?.user)}
            size="large"
            promoted
          />
        ))}
      </LargeCardRail>
    </section>
  );
}
