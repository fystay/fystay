import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buttonVariants } from "@/components/ui/Button";
import { getActiveOfferingByCategory } from "@/lib/travelAddons";
import { TravelAddonLanding } from "@/components/travel-extras/TravelAddonLanding";
import { cn } from "@/lib/cn";
import type { ExtraCategory } from "@prisma/client";
import { todayStayDate } from "@/lib/stayDates";

const CATEGORIES: ExtraCategory[] = ["AIRPORT_TRANSFER", "ATTRACTION_TICKET", "CAR_HIRE"];

// Content varies entirely by query string (category, and since Phase 9 also
// destination/hotel/dates/guests carried through from a cross-sell surface -
// see travelAddonHref in src/lib/travelAddons.ts) with no canonical set, the
// same "one URL shape renders many different combinations" pattern /hotels
// and /hotels/[destination]/[hotelSlug] are deliberately noindexed for -
// this page follows that same convention rather than indexing whichever
// query-param combination a crawler happens to hit first.
export const metadata: Metadata = { title: "Travel", robots: { index: false, follow: true } };

type SearchParams = {
  category?: string;
  destination?: string;
  hotel?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: string;
  children?: string;
};

/**
 * One generic landing page for whichever travel add-on category a CTA
 * points to (see src/lib/travelAddons.ts's travelAddonHref) - EV Exec's
 * airport transfer is the first, but this same page serves any future
 * ExtraCategory without a new route (see item 7 of the cross-sell brief).
 */
export default async function TravelExtrasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolved = await searchParams;
  const category = CATEGORIES.includes(resolved.category as ExtraCategory)
    ? (resolved.category as ExtraCategory)
    : "AIRPORT_TRANSFER";

  const offering = await getActiveOfferingByCategory(category);

  if (!offering) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-6 py-16 text-center">
        <Compass className="h-8 w-8 text-stone-400" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Nothing available right now</h1>
        <p className="mt-2 max-w-sm text-sm text-stone-500">
          There&apos;s no travel extra live in this category yet. Check back soon.
        </p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>
          Back to FYStay
        </Link>
      </div>
    );
  }

  const session = await auth();
  // The guest's next stay - a transfer for a trip that's already happened
  // is no use to anyone.
  const eligibleBooking = session?.user
    ? await prisma.booking.findFirst({
        where: { guestId: session.user.id, status: "CONFIRMED", checkOut: { gte: todayStayDate() } },
        orderBy: { checkIn: "asc" },
        select: { id: true },
      })
    : null;

  // Purely informational context a cross-sell surface (e.g. the hotel
  // affiliate detail page) may have carried through in the URL - see
  // travelAddonHref/TravelAddonContext in src/lib/travelAddons.ts. Never
  // affects eligibleBooking above or which CTA TravelAddonLanding shows;
  // it only lets this generic landing page acknowledge the trip the guest
  // was actually looking at a moment ago.
  const parsedAdults = resolved.adults ? Number(resolved.adults) : NaN;
  const parsedChildren = resolved.children ? Number(resolved.children) : NaN;
  const tripContext =
    resolved.destination || resolved.hotel || resolved.checkIn || resolved.checkOut
      ? {
          destination: resolved.destination ?? null,
          hotelName: resolved.hotel ?? null,
          checkIn: resolved.checkIn ?? null,
          checkOut: resolved.checkOut ?? null,
          adults: Number.isFinite(parsedAdults) ? parsedAdults : null,
          children: Number.isFinite(parsedChildren) ? parsedChildren : null,
        }
      : null;

  return (
    <TravelAddonLanding
      offering={offering}
      eligibleBookingId={eligibleBooking?.id ?? null}
      tripContext={tripContext}
    />
  );
}
