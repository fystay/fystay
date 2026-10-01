"use client";

import { useRef, useState } from "react";
import type { TouchEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ImageOff, MapPin, Star, Users } from "lucide-react";
import { useFormattedPrice } from "@/components/CurrencyProvider";
import { isOptimizableImage } from "@/lib/image";
import { computeBookingPricing } from "@/lib/pricing";
import { SaveButton } from "@/components/SaveButton";
import { averageRating as computeAverageRating } from "@/lib/reviews";
import { AMENITY_CATEGORIES } from "@/lib/amenityCategories";
import { cn } from "@/lib/cn";
import { withCity } from "@/lib/seo";
import { distanceMiles, estimateDriveMinutes, estimateWalkMinutes } from "@/lib/geo";
import { EntryLocationMeta } from "@/components/EntryLocationMeta";

export type ListingCardData = {
  id: string;
  title: string;
  city: string;
  country: string;
  pricePerNightCents: number;
  cleaningFeeCents: number;
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
  photos: string[];
  amenities: string[];
  maxGuests: number;
  bedrooms: number;
  reviews: { rating: number }[];
  latitude?: number | null;
  longitude?: number | null;
};

const MAX_AMENITY_ICONS = 3;
const SWIPE_THRESHOLD_PX = 30;

export function ListingCard({
  listing,
  isSaved = false,
  isLoggedIn = false,
  nights,
  nearLandmark,
  stayQuery = "",
}: {
  listing: ListingCardData;
  isSaved?: boolean;
  isLoggedIn?: boolean;
  /** Length of the stay currently searched for, if any - when set, the
   * card shows the total price for that stay next to the nightly rate
   * (search results only; browse carousels don't have a date range). */
  nights?: number;
  /** The specific named place the current search is scoped to, if any (see
   * DestinationAutocomplete's landmark suggestions) - shown as a real
   * distance/walk/drive line so a guest can see exactly why this result
   * surfaced, not just trust an invisible sort order. */
  nearLandmark?: { name: string; latitude: number; longitude: number };
  /** The searched stay as a query string (see buildStayQuery), appended to the listing link. */
  stayQuery?: string;
}) {
  const rating = computeAverageRating(listing.reviews);
  const landmarkDistance =
    nearLandmark && listing.latitude != null && listing.longitude != null
      ? (() => {
          const miles = distanceMiles(nearLandmark, { latitude: listing.latitude, longitude: listing.longitude });
          return {
            distanceMiles: Math.round(miles * 10) / 10,
            walkMinutes: estimateWalkMinutes(miles),
            driveMinutes: estimateDriveMinutes(miles),
          };
        })()
      : null;
  const reviewCount = listing.reviews.length;
  const keyAmenities = AMENITY_CATEGORIES.filter((category) =>
    category.test(listing.amenities),
  ).slice(0, MAX_AMENITY_ICONS);

  // A deal-style ribbon (the "SALE"/"% OFF" tag airline sites lead their
  // own deal tiles with) for a listing that actually has a real length-of-
  // stay discount configured - never fabricated, just a more visible read
  // of a real Listing.weeklyDiscountPercent/monthlyDiscountPercent value
  // that otherwise only surfaces once a guest has picked dates long enough
  // to trigger it (see computeBookingPricing). Monthly takes priority when
  // both are set - it's the larger saving a host is offering.
  const dealLabel = listing.monthlyDiscountPercent
    ? `${listing.monthlyDiscountPercent}% off monthly`
    : listing.weeklyDiscountPercent
      ? `${listing.weeklyDiscountPercent}% off weekly`
      : null;

  const photoCount = listing.photos.length;
  const [photoIndex, setPhotoIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

  function goToPhoto(index: number) {
    setPhotoIndex(((index % photoCount) + photoCount) % photoCount);
  }

  // Swiping across the photo shouldn't also navigate to the listing:
  // mobile browsers already suppress the anchor's click event once a touch
  // has moved past a small threshold, so changing the index here on
  // touchend is enough - a plain tap (no meaningful movement) still falls
  // through to the Link underneath as a normal navigation.
  function handleTouchStart(e: TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: TouchEvent) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (delta <= -SWIPE_THRESHOLD_PX) goToPhoto(photoIndex + 1);
    else if (delta >= SWIPE_THRESHOLD_PX) goToPhoto(photoIndex - 1);
  }

  const totalPriceCents =
    nights && nights > 0
      ? computeBookingPricing({
          nights,
          pricePerNightCents: listing.pricePerNightCents,
          cleaningFeeCents: listing.cleaningFeeCents,
          weeklyDiscountPercent: listing.weeklyDiscountPercent,
          monthlyDiscountPercent: listing.monthlyDiscountPercent,
        }).totalPriceCents
      : null;

  // Called unconditionally (hooks can't be conditional) even though
  // totalPriceCents may be null - formattedTotal is simply unused in that
  // case, exactly like the totalPriceCents !== null check below already
  // gates whether it renders.
  const formattedNightlyPrice = useFormattedPrice(listing.pricePerNightCents);
  const formattedTotal = useFormattedPrice(totalPriceCents ?? 0);

  return (
    // The lift-on-hover applies to the whole card (image and text together)
    // rather than just zooming the photo - a plain `hover:` here, not
    // `group-hover:`, since :hover already bubbles up to this element from
    // either Link inside it (and, the same way, :active bubbles up from
    // tapping either Link too - a touch press briefly shrinks the whole
    // card instead of relying on the lift, which globals.css now restricts
    // to devices with a real hover-capable pointer). transition-transform
    // is separate from the image's own transition so the two don't fight
    // over timing.
    <div className="group flex flex-col gap-3.5 transition-transform duration-300 hover:-translate-y-1 focus-within:-translate-y-1 active:scale-[0.98]">
      {/* aspect-[5/4] (not the old 4/3) - a touch taller and closer to
          square, the crop a considered property brochure uses rather
          than a wide filmstrip thumbnail. */}
      <div className="relative aspect-[5/4] w-full overflow-hidden rounded-2xl bg-brand-50 shadow-[var(--shadow-card)] ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-[var(--shadow-card-hover)] group-hover:ring-brand-200">
        <Link
          href={`/listings/${listing.id}${stayQuery}`}
          className="focus-ring absolute inset-0 block rounded-2xl"
          onTouchStart={photoCount > 1 ? handleTouchStart : undefined}
          onTouchEnd={photoCount > 1 ? handleTouchEnd : undefined}
        >
          {photoCount > 0 ? (
            <div
              className="flex h-full w-full transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${photoIndex * 100}%)` }}
            >
              {listing.photos.map((photo, i) => (
                <div key={i} className="relative h-full w-full shrink-0">
                  <Image
                    src={photo}
                    alt={withCity(listing.title, listing.city)}
                    fill
                    className="object-cover transition duration-300 group-hover:scale-105"
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    unoptimized={!isOptimizableImage(photo)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-brand-300">
              <ImageOff className="h-6 w-6" />
              <span className="text-xs font-medium text-brand-400">Photo coming soon</span>
            </div>
          )}
        </Link>

        {photoCount > 1 && (
          <>
            {/* Desktop-only prev/next, shown on hover - mobile relies on
                the swipe handlers on the Link above instead. Siblings of
                the Link rather than nested inside it, so a click here
                changes the photo without also triggering navigation. */}
            <button
              type="button"
              onClick={() => goToPhoto(photoIndex - 1)}
              aria-label="Previous photo"
              className="absolute left-1.5 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/80 p-1 text-foreground opacity-0 shadow-[var(--shadow-card)] backdrop-blur-sm transition hover:bg-white group-hover:opacity-100 sm:flex"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => goToPhoto(photoIndex + 1)}
              aria-label="Next photo"
              className="absolute right-1.5 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white/80 p-1 text-foreground opacity-0 shadow-[var(--shadow-card)] backdrop-blur-sm transition hover:bg-white group-hover:opacity-100 sm:flex"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1">
              {listing.photos.map((_, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-all",
                    i === photoIndex ? "bg-white" : "bg-white/50",
                  )}
                />
              ))}
            </div>
          </>
        )}

        {dealLabel && (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-accent-500 px-2.5 py-1 text-xs font-semibold text-ink shadow-[var(--shadow-card)]">
            {dealLabel}
          </span>
        )}

        <SaveButton
          listingId={listing.id}
          initialSaved={isSaved}
          isLoggedIn={isLoggedIn}
          className="absolute right-2.5 top-2.5 z-10 h-10 w-10 bg-white/80 shadow-[var(--shadow-card)] backdrop-blur-sm hover:bg-white active:scale-90"
        />
      </div>
      <Link href={`/listings/${listing.id}${stayQuery}`} className="focus-ring flex flex-col gap-2 rounded-xl">
        {/* min-h keeps this row the same height whether the title wraps to
            one line or two, so price/rating rows still line up across a
            row of cards regardless of title length. */}
        <p
          data-testid="listing-card-title"
          className="line-clamp-2 min-h-[2.75rem] text-base font-semibold leading-snug tracking-tight text-foreground transition-colors duration-200 group-hover:text-brand-800"
        >
          {listing.title}
        </p>
        <p className="flex items-center gap-1 text-sm text-stone-500">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
          <span className="truncate">
            {listing.city}, {listing.country}
          </span>
        </p>
        {landmarkDistance && <EntryLocationMeta location={landmarkDistance} />}
        <p className="flex items-center gap-1 text-xs text-stone-500">
          <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {listing.maxGuests} guest{listing.maxGuests === 1 ? "" : "s"}
          <span aria-hidden>·</span>
          {listing.bedrooms} bedroom{listing.bedrooms === 1 ? "" : "s"}
        </p>
        {keyAmenities.length > 0 && (
          <ul className="flex items-center gap-3">
            {keyAmenities.map((category) => (
              <li key={category.key} className="flex items-center gap-1 text-xs text-stone-500">
                <category.icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{category.label}</span>
              </li>
            ))}
          </ul>
        )}
        {/* items-start (not items-end, this used to be a single price
            line) - the rating/New chip now aligns with the top of the
            price block, which reads correctly whether or not the second
            "total" line below it is present. */}
        <div className="mt-2.5 flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            {/* The nightly rate in the site's own display serif, the same
                face every page heading uses (see globals.css) - a
                deliberate "rate card" numeral instead of the bold sans
                figure Airbnb/Booking both use, so the price reads as this
                platform's own voice rather than a copy of theirs. No
                font-weight utility here on purpose: DM Serif Display only
                ships one real weight, and combining it with a bold/
                semibold class would make the browser fake one (the same
                synthetic-bold issue globals.css's h1/h2 rule exists to
                prevent - this element isn't an h1/h2, so nothing catches
                that mistake for it automatically). */}
            <p className="flex items-baseline gap-1">
              <span className="font-serif text-xl tabular-nums text-brand-800">
                {formattedNightlyPrice}
              </span>
              <span className="text-xs text-stone-500">/ night</span>
            </p>
            {totalPriceCents !== null && (
              <span className="text-xs text-stone-500">{formattedTotal} total</span>
            )}
          </div>
          {rating !== null ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-border-subtle bg-surface px-2 py-1 text-xs font-medium text-stone-700">
              <Star className="h-3.5 w-3.5 fill-accent-500 text-accent-500" aria-hidden />
              {rating.toFixed(1)}
              {reviewCount > 0 && <span className="text-stone-500">({reviewCount})</span>}
            </span>
          ) : (
            // A blank gap here (rather than a placeholder) reads as broken
            // or missing data next to cards that do have a rating in the
            // same grid - and every listing starts with zero reviews, so
            // this isn't a rare case. "New" reframes it as a fact about
            // the listing instead of an absence. Bordered, like the rating
            // chip above, so the two states share one visual weight in a
            // mixed grid - filled rather than outlined so it still reads
            // as a small status flag, not just another data chip.
            <span className="shrink-0 rounded-full border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
              New
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
