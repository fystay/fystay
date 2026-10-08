import { addDays } from "date-fns";
import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guestNightlyPriceCents } from "@/lib/pricing";
import {
  ArrowRight,
  Bath,
  BedDouble,
  BookOpen,
  ClipboardList,
  DoorOpen,
  Home,
  ListChecks,
  MapPin,
  ParkingSquare,
  PawPrint,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { blockingBookingWhere, blockingRanges } from "@/lib/availability";
import { resolveCancellationPolicy } from "@/lib/cancellationPolicy";
import { hasParking, isPetFriendly } from "@/lib/search";
import { auth } from "@/auth";
import { BookingWidget } from "@/components/BookingWidget";
import { HotelBookingWidget } from "@/components/HotelBookingWidget";
import { HotelRoomsBar } from "@/components/HotelRoomsBar";
import { PhotoGallery } from "@/components/PhotoGallery";
import { AmenitiesSection } from "@/components/AmenitiesSection";
import { NearbyAttractions } from "@/components/NearbyAttractions";
import { HostCard } from "@/components/HostCard";
import { ReadMoreText } from "@/components/ReadMoreText";
import { WhatGuestsLove } from "@/components/WhatGuestsLove";
import { GoodToKnow, type GoodToKnowRow } from "@/components/GoodToKnow";
import { HouseRules } from "@/components/HouseRules";
import { WhyBookWithFYStay } from "@/components/WhyBookWithFYStay";
import { PropertyTransferPromo } from "@/components/PropertyTransferPromo";
import { TrustLine } from "@/components/TrustLine";
import { ListingsMap } from "@/components/ListingsMap";
import { ReviewSummary } from "@/components/ReviewSummary";
import { ReviewList } from "@/components/ReviewList";
import { SectionHeading } from "@/components/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { LOCAL_GUIDES } from "@/lib/localGuide";
import { SITE_NAME, SITE_URL, withCity } from "@/lib/seo";
import { computeRatingBreakdown } from "@/lib/reviews";
import { computeHostResponseStats, isGreatHost } from "@/lib/hostStats";
import { PROPERTY_TYPE_LABEL } from "@/lib/propertyType";
import { getFeaturedOffering } from "@/lib/travelAddons";
import { formatPrice } from "@/lib/format";
import { isSuspended } from "@/lib/suspension";
import { parseStaySelection } from "@/lib/stayQuery";
import { hostAcceptsPaidBookings } from "@/lib/stripeConnect";
import { activePriceDrop } from "@/lib/deals";

const getListing = cache(async (id: string) => {
  return prisma.listing.findUnique({
    where: { id },
    include: {
      host: {
        select: {
          name: true,
          image: true,
          createdAt: true,
          identityVerificationStatus: true,
          stripeConnectChargesEnabled: true,
          stripeConnectPayoutsEnabled: true,
        },
      },
      bookings: {
        where: blockingBookingWhere(),
        select: {
          checkIn: true,
          checkOut: true,
          guestId: true,
          status: true,
          paymentStatus: true,
          approvalStatus: true,
        },
      },
      availabilityBlocks: {
        select: { startDate: true, endDate: true },
      },
      reviews: {
        where: { status: "PUBLISHED" },
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      roomTypes: { orderBy: { pricePerNightCents: "asc" } },
    },
  });
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const listing = await getListing(id);
  // A suspended listing gets no metadata/indexing, the same as an
  // unpublished one - it may still 200 for its own host below, but that's
  // not a page search engines (or link previews) should ever surface.
  if (!listing || !listing.published) return {};
  if (isSuspended(listing)) return { robots: { index: false, follow: false } };

  const title = withCity(listing.title, listing.city);
  const description = `${PROPERTY_TYPE_LABEL[listing.propertyType]} in ${listing.city}, ${listing.country} - ${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}, sleeps ${listing.maxGuests}, from ${formatPrice(guestNightlyPriceCents(listing.pricePerNightCents))}/night incl. service fee. ${listing.description.slice(0, 110)}`;
  const url = `${SITE_URL}/listings/${listing.id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      images: listing.photos[0] ? [{ url: listing.photos[0] }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: listing.photos[0] ? [listing.photos[0]] : undefined,
    },
  };
}

export default async function ListingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const staySelection = parseStaySelection(await searchParams);
  const [listing, session, featuredAddonOffering] = await Promise.all([
    getListing(id),
    auth(),
    getFeaturedOffering(),
  ]);

  if (!listing || !listing.published) {
    notFound();
  }

  // A suspended listing still 200s for its own host (so they can see why)
  // and for an admin, but a guest gets a simple "no longer available"
  // state instead of the full bookable page - see Listing.suspendedAt's
  // own schema comment. Checked before the heavier stats queries below so
  // a suspended listing's page never pays for work only the full view needs.
  const canViewSuspendedListing =
    session?.user?.id === listing.hostId || session?.user?.role === "ADMIN";
  if (isSuspended(listing) && !canViewSuspendedListing) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <h1 className="text-xl font-semibold text-foreground">This listing is no longer available</h1>
        <p className="text-stone-600">
          It&apos;s been taken down and can&apos;t be booked. Have a look at other stays instead.
        </p>
        <Link href="/search" className="mt-2 font-medium text-brand-700 hover:underline">
          Browse other stays
        </Link>
      </div>
    );
  }

  const [isSaved, hostReviewStats, hostConversations, hostCompletedBookings] = await Promise.all([
    session?.user
      ? prisma.savedListing
          .findUnique({
            where: { userId_listingId: { userId: session.user.id, listingId: listing.id } },
          })
          .then(Boolean)
      : Promise.resolve(false),
    // Across every listing this host runs, not just this one - a host with
    // one glowing review on their tenth property and a host with their
    // first-ever review look identical from a single listing's own count.
    prisma.review.aggregate({
      where: { status: "PUBLISHED", listing: { hostId: listing.hostId } },
      _count: true,
      _avg: { rating: true },
    }),
    // Same "every listing, not just this one" reasoning as hostReviewStats
    // above - response rate/time is a fact about the host, not this listing.
    // Bounded the same way as the host's own dashboard (the last year, the
    // opening exchange of each conversation), so the two show the same
    // figure and a busy host's listing page doesn't read every message
    // they've ever sent.
    prisma.conversation.findMany({
      where: { hostId: listing.hostId, updatedAt: { gte: addDays(new Date(), -365) } },
      select: {
        hostId: true,
        guestId: true,
        messages: { select: { senderId: true, createdAt: true }, take: 20, orderBy: { createdAt: "asc" } },
      },
    }),
    // Also host-wide - see isGreatHost in hostStats.ts for why this, the
    // host's average rating, and their response rate all have to be met
    // together before the "Great Host" badge shows at all.
    prisma.booking.count({
      where: { status: "COMPLETED", listing: { hostId: listing.hostId } },
    }),
  ]);
  const hostReviewCount = hostReviewStats._count;
  const { responseRate, medianResponseMinutes } = computeHostResponseStats(hostConversations);
  const hostIsGreat = isGreatHost({
    completedBookings: hostCompletedBookings,
    averageRating: hostReviewStats._avg.rating,
    responseRate,
  });

  const reportedReviewIds = session?.user
    ? new Set(
        (
          await prisma.reviewReport.findMany({
            where: {
              reporterId: session.user.id,
              reviewId: { in: listing.reviews.map((r) => r.id) },
            },
            select: { reviewId: true },
          })
        ).map((r) => r.reviewId),
      )
    : new Set<string>();

  const stats = [
    { icon: Users, label: `${listing.maxGuests} guest${listing.maxGuests > 1 ? "s" : ""}` },
    { icon: DoorOpen, label: `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"}` },
    { icon: BedDouble, label: `${listing.beds} bed${listing.beds === 1 ? "" : "s"}` },
    { icon: Bath, label: `${listing.bathrooms} bath${listing.bathrooms === 1 ? "" : "s"}` },
  ];

  const ratingBreakdown = computeRatingBreakdown(listing.reviews);
  const rating = ratingBreakdown.average;
  const reviewCount = listing.reviews.length;
  const cancellationPolicy = resolveCancellationPolicy(listing);
  const petsAllowed = isPetFriendly(listing.amenities);
  const parkingAvailable = hasParking(listing.amenities);

  const goodToKnowRows: GoodToKnowRow[] = [
    { icon: Users, label: "Maximum guests", value: `${listing.maxGuests}` },
    ...(parkingAvailable ? [{ icon: ParkingSquare, label: "Parking", value: "Available" }] : []),
    ...(petsAllowed ? [{ icon: PawPrint, label: "Pets", value: "Allowed" }] : []),
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description,
    image: listing.photos,
    url: `${SITE_URL}/listings/${listing.id}`,
    brand: { "@type": "Brand", name: SITE_NAME },
    category: PROPERTY_TYPE_LABEL[listing.propertyType],
    address: {
      "@type": "PostalAddress",
      addressLocality: listing.city,
      addressCountry: listing.country,
    },
    additionalProperty: [
      { "@type": "PropertyValue", name: "Bedrooms", value: listing.bedrooms },
      { "@type": "PropertyValue", name: "Beds", value: listing.beds },
      { "@type": "PropertyValue", name: "Bathrooms", value: listing.bathrooms },
      { "@type": "PropertyValue", name: "Maximum occupancy", value: listing.maxGuests },
    ],
    offers: {
      "@type": "Offer",
      // What a guest pays per night, service fee included - as shown on the page.
      price: (guestNightlyPriceCents(listing.pricePerNightCents) / 100).toFixed(2),
      priceCurrency: "GBP",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/listings/${listing.id}`,
    },
    ...(reviewCount > 0 && rating !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: rating.toFixed(1),
            reviewCount,
          },
        }
      : {}),
  };

  // Home > city > this listing - lets a search result show the listing's
  // place in the site instead of a bare URL, and gives an AI crawler the
  // same "where does this page sit" signal a human gets from a breadcrumb
  // trail. The city link points at that town's own indexable
  // /destinations page when one exists, rather than the noindexed
  // /search?city= results view - a breadcrumb is only useful to a crawler
  // if it can actually follow it somewhere worth ranking.
  const cityDestination = FYLDE_COAST_DESTINATIONS.find(
    (destination) => destination.searchCity.toLowerCase() === listing.city.toLowerCase(),
  );
  const cityUrl = cityDestination
    ? `${SITE_URL}/destinations/${cityDestination.slug}`
    : `${SITE_URL}/search?city=${encodeURIComponent(listing.city)}`;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: listing.city, item: cityUrl },
      {
        "@type": "ListItem",
        position: 3,
        name: listing.title,
        item: `${SITE_URL}/listings/${listing.id}`,
      },
    ],
  };

  const localGuide = cityDestination ? LOCAL_GUIDES[cityDestination.slug] : undefined;
  const isOwnListing = session?.user?.id === listing.hostId;

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c") }}
      />

      <PhotoGallery
        photos={listing.photos}
        title={listing.title}
        listingId={listing.id}
        isSaved={isSaved}
        isLoggedIn={Boolean(session?.user)}
      />

      <div className="mt-6 flex flex-col gap-3">
        <p className="flex items-center gap-1.5 text-sm text-stone-500">
          <MapPin className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
          {listing.city}, {listing.country}
        </p>
        <Badge variant="brand" className="w-fit">
          {PROPERTY_TYPE_LABEL[listing.propertyType]}
        </Badge>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-foreground sm:text-3xl">
          {listing.title}
        </h1>
        <TrustLine rating={rating} reviewCount={reviewCount} />
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-stone-700">
          {stats.map(({ icon: Icon, label }) => (
            <span key={label} className="flex items-center gap-2">
              <Icon className="h-4.5 w-4.5 text-brand-600" />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HostCard
            hostName={listing.host.name}
            hostImage={listing.host.image}
            hostingSinceYear={listing.host.createdAt.getFullYear()}
            reviewCount={hostReviewCount}
            responseRate={responseRate}
            medianResponseMinutes={medianResponseMinutes}
            isGreatHost={hostIsGreat}
            isIdentityVerified={listing.host.identityVerificationStatus === "VERIFIED"}
            listingId={listing.id}
            isLoggedIn={Boolean(session?.user)}
            isOwnListing={isOwnListing}
          />

          <div className="mt-10 border-t border-border-subtle pt-8">
            <SectionHeading icon={Home}>About this stay</SectionHeading>
            <ReadMoreText text={listing.description} className="mt-3 whitespace-pre-line text-stone-700" />
            <WhatGuestsLove categoryAverages={ratingBreakdown.categoryAverages} reviewCount={reviewCount} />
          </div>

          {listing.amenities.length > 0 && (
            <div className="mt-10 border-t border-border-subtle pt-8">
              <SectionHeading icon={Sparkles}>What this place offers</SectionHeading>
              <AmenitiesSection amenities={listing.amenities} />
            </div>
          )}

          <div className="mt-10 border-t border-border-subtle pt-8">
            <SectionHeading icon={MapPin}>Where you&apos;ll be</SectionHeading>
            <p className="mt-3 text-stone-700">
              {listing.city}, {listing.country}
            </p>
            {listing.latitude !== null && listing.longitude !== null && (
              <div className="mt-4">
                <ListingsMap
                  listings={[
                    {
                      id: listing.id,
                      title: listing.title,
                      city: listing.city,
                      photo: listing.photos[0] ?? null,
                      pricePerNightCents: listing.pricePerNightCents,
                      latitude: listing.latitude,
                      longitude: listing.longitude,
                    },
                  ]}
                />
              </div>
            )}
            {localGuide?.insiderTip && (
              <p className="mt-4 border-l-2 border-brand-200 pl-4 text-sm italic text-stone-600">
                &ldquo;{localGuide.insiderTip}&rdquo;
              </p>
            )}
            <NearbyAttractions latitude={listing.latitude} longitude={listing.longitude} />
          </div>

          {cityDestination && localGuide && (
            <Link
              href={`/destinations/${cityDestination.slug}?from=${listing.id}#local-guide`}
              className="focus-ring mt-8 flex items-center justify-between gap-3 rounded-2xl border border-brand-100 bg-brand-50 px-5 py-4 text-sm font-medium text-brand-800 transition hover:bg-brand-100"
            >
              <span className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
                Read the full {listing.city} Local Guide - things to do, eat and explore nearby
              </span>
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </Link>
          )}

          <div className="mt-10 border-t border-border-subtle pt-8">
            <SectionHeading icon={ClipboardList}>Good to know</SectionHeading>
            <GoodToKnow rows={goodToKnowRows} />
          </div>

          <div className="mt-10 border-t border-border-subtle pt-8">
            <SectionHeading icon={ListChecks}>House rules</SectionHeading>
            <HouseRules listing={listing} />
          </div>

          <div className="mt-10 border-t border-border-subtle pt-8">
            <SectionHeading icon={ShieldCheck} id="cancellation-policy">
              Cancellation policy
            </SectionHeading>
            <p className="mt-3 text-stone-700">
              <span className="font-medium text-foreground">{cancellationPolicy.label}.</span>{" "}
              {cancellationPolicy.description}
            </p>
          </div>

          <div className="border-t border-border-subtle pt-2">
            <WhyBookWithFYStay />
          </div>

          <div className="mt-10 border-t border-border-subtle pt-8" id="reviews">
            <SectionHeading icon={Star}>Guest reviews</SectionHeading>
            {reviewCount > 0 ? (
              <>
                <div className="mt-4">
                  <ReviewSummary reviews={listing.reviews} />
                </div>
                <ReviewList
                  reviews={listing.reviews}
                  hostName={listing.host.name}
                  viewerId={session?.user?.id}
                  reportedReviewIds={reportedReviewIds}
                />
              </>
            ) : (
              <div className="mt-4 flex flex-col items-start gap-2">
                <TrustLine rating={null} reviewCount={0} />
                <p className="text-stone-700">
                  Be one of the first guests to stay here and leave a review - reviews only appear
                  once a guest has completed a real, paid booking.
                </p>
              </div>
            )}
          </div>
        </div>

        <div id="booking-widget">
          {listing.propertyType === "HOTEL" ? (
            <HotelBookingWidget
              listingId={listing.id}
              roomTypes={listing.roomTypes}
              cleaningFeeCents={listing.cleaningFeeCents}
              weeklyDiscountPercent={listing.weeklyDiscountPercent}
              monthlyDiscountPercent={listing.monthlyDiscountPercent}
              lastMinuteDiscountPercent={listing.lastMinuteDiscountPercent}
              lastMinuteWindowDays={listing.lastMinuteWindowDays}
              minNights={listing.minNights}
              maxNights={listing.maxNights}
              isLoggedIn={Boolean(session?.user)}
              cancellationPolicy={cancellationPolicy}
              instantBook={listing.instantBook}
              initialSelection={staySelection}
              acceptsPaidBookings={hostAcceptsPaidBookings(listing.host)}
            />
          ) : (
            <BookingWidget
              listingId={listing.id}
              pricePerNightCents={listing.pricePerNightCents}
              cleaningFeeCents={listing.cleaningFeeCents}
              weeklyDiscountPercent={listing.weeklyDiscountPercent}
              monthlyDiscountPercent={listing.monthlyDiscountPercent}
              lastMinuteDiscountPercent={listing.lastMinuteDiscountPercent}
              lastMinuteWindowDays={listing.lastMinuteWindowDays}
              priceDropFromCents={activePriceDrop(listing)?.fromCents ?? null}
              minNights={listing.minNights}
              maxNights={listing.maxNights}
              maxGuests={listing.maxGuests}
              amenities={listing.amenities}
              bookedRanges={blockingRanges(
                // The viewer's own unpaid instant-book hold isn't shown as
                // taken to them, so going back from checkout lets them pick
                // the same stay again and carry on with that booking.
                listing.bookings.filter(
                  (booking) =>
                    !(
                      session?.user &&
                      booking.guestId === session.user.id &&
                      booking.status === "PENDING" &&
                      booking.paymentStatus === "UNPAID" &&
                      booking.approvalStatus === "NONE"
                    ),
                ),
                listing.availabilityBlocks,
              ).map(
                (r) => ({ checkIn: r.checkIn.toISOString(), checkOut: r.checkOut.toISOString() }),
              )}
              isLoggedIn={Boolean(session?.user)}
              rating={rating}
              reviewCount={reviewCount}
              cancellationPolicy={cancellationPolicy}
              securityDepositCents={listing.securityDepositCents}
              instantBook={listing.instantBook}
              initialSelection={staySelection}
              acceptsPaidBookings={hostAcceptsPaidBookings(listing.host)}
            />
          )}

          {featuredAddonOffering && <PropertyTransferPromo offering={featuredAddonOffering} />}
        </div>
      </div>

      {/* A non-hotel listing's widget renders its own bar, with the chosen dates' total. */}
      {listing.propertyType === "HOTEL" && <HotelRoomsBar pricePerNightCents={listing.pricePerNightCents} />}
    </div>
  );
}
