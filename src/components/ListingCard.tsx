"use client";

import { useRef } from "react";
import type { TouchEvent } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ImageOff, MapPin, Star, Users } from "lucide-react";
import { useFormattedPrice } from "@/components/CurrencyProvider";
import { computeBookingPricing } from "@/lib/pricing";
import { SaveButton } from "@/components/SaveButton";
import { averageRating as computeAverageRating } from "@/lib/reviews";
import { AMENITY_CATEGORIES } from "@/lib/amenityCategories";
import { cn } from "@/lib/cn";
import { withCity } from "@/lib/seo";
import { distanceMiles, estimateDriveMinutes, estimateWalkMinutes } from "@/lib/geo";
import { EntryLocationMeta } from "@/components/EntryLocationMeta";
import { CrossfadeImages } from "@/components/CrossfadeImages";
import { useAutoRotate } from "@/hooks/useAutoRotate";
import { LARGE_CARD_IMAGE_CLASS } from "@/components/LargeCard";
import { lastMinuteDiscountFor, listingDeal } from "@/lib/deals";
import { parseStayDate } from "@/lib/stayDates";

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
  // Deal fields (src/lib/deals.ts) - optional, so callers that don't select
  // them simply show no deal.
  lastMinuteDiscountPercent?: number | null;
  lastMinuteWindowDays?: number | null;
  priceDropFromCents?: number | null;
  priceDroppedAt?: Date | null;
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
  size = "default",
  promoted = false,
  checkIn,
  showLastMinutePrice = false,
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
  /**
   * "large": the homepage's large, image-led card (see LargeCardRail) -
   * bigger image and corners, first photo only (a horizontal swipe on the
   * card belongs to the rail, not to a photo carousel inside it), and only
   * title, location, price and rating beneath it.
   */
  size?: "default" | "large";
  /** A paid Spotlight placement (see src/lib/listingPromotions.ts): labelled "Promoted" on the photo, as UK rules on paid placement require. */
  promoted?: boolean;
  /** The searched check-in (yyyy-MM-dd), so the stay total includes a last-minute deal when it applies. */
  checkIn?: string;
  /**
   * Show a last-minute deal's discounted nightly rate (the full rate struck
   * through beside it) without a searched check-in - for the Last Minute
   * Deals row, which only lists a deal when a night inside its window is free.
   */
  showLastMinutePrice?: boolean;
}) {
  const isLarge = size === "large";
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
  // A real last-minute deal or price drop (src/lib/deals.ts) takes the
  // ribbon ahead of a length-of-stay discount - it's the more urgent offer.
  const deal = listingDeal({
    lastMinuteDiscountPercent: listing.lastMinuteDiscountPercent ?? null,
    lastMinuteWindowDays: listing.lastMinuteWindowDays ?? null,
    pricePerNightCents: listing.pricePerNightCents,
    priceDropFromCents: listing.priceDropFromCents ?? null,
    priceDroppedAt: listing.priceDroppedAt ? new Date(listing.priceDroppedAt) : null,
  });
  const dealLabel = deal
    ? `${deal.percentOff}% off`
    : listing.monthlyDiscountPercent
      ? `${listing.monthlyDiscountPercent}% off monthly`
      : listing.weeklyDiscountPercent
        ? `${listing.weeklyDiscountPercent}% off weekly`
        : null;

  const photoCount = listing.photos.length;
  // Gentle automatic crossfade through the listing's photos (see
  // useAutoRotate for when it runs and pauses). Large cards rotate too but
  // get no arrows, dots or photo swipe: a sideways swipe on them belongs to
  // the rail they sit in (LargeCardRail).
  const {
    observe: observePhotos,
    index: photoIndex,
    previous: previousPhotoIndex,
    goTo: goToPhoto,
    handlers: rotationHandlers,
    preloadNext,
  } = useAutoRotate<HTMLDivElement>({ count: photoCount, seed: listing.id });
  const showPhotoControls = !isLarge && photoCount > 1;
  const touchStartX = useRef<number | null>(null);

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

  // The last-minute percentage the searched check-in gets, if any.
  const searchedLastMinutePercent = checkIn
    ? lastMinuteDiscountFor(
        {
          lastMinuteDiscountPercent: listing.lastMinuteDiscountPercent ?? null,
          lastMinuteWindowDays: listing.lastMinuteWindowDays ?? null,
        },
        parseStayDate(checkIn) ?? new Date(0),
      )
    : null;

  const totalPriceCents =
    nights && nights > 0
      ? computeBookingPricing({
          nights,
          pricePerNightCents: listing.pricePerNightCents,
          cleaningFeeCents: listing.cleaningFeeCents,
          weeklyDiscountPercent: listing.weeklyDiscountPercent,
          monthlyDiscountPercent: listing.monthlyDiscountPercent,
          lastMinuteDiscountPercent: searchedLastMinutePercent,
        }).totalPriceCents
      : null;

  // The nightly rate to lead with, and the higher genuine rate to strike
  // through beside it: a price drop's earlier price, or the full rate when
  // the headline last-minute deal applies (the searched check-in is inside
  // its window, or the card sits in the Last Minute Deals row).
  const lastMinutePercent =
    deal?.kind === "last_minute" && (showLastMinutePrice || searchedLastMinutePercent !== null)
      ? deal.percentOff
      : null;
  const shownNightlyCents =
    lastMinutePercent !== null
      ? listing.pricePerNightCents - Math.round((listing.pricePerNightCents * lastMinutePercent) / 100)
      : listing.pricePerNightCents;
  const struckNightlyCents =
    deal?.kind === "price_drop" ? deal.fromCents : lastMinutePercent !== null ? listing.pricePerNightCents : null;

  // Called unconditionally (hooks can't be conditional) even though
  // totalPriceCents may be null - formattedTotal is simply unused in that
  // case, exactly like the totalPriceCents !== null check below already
  // gates whether it renders.
  const formattedNightlyPrice = useFormattedPrice(shownNightlyCents);
  const formattedWasPrice = useFormattedPrice(struckNightlyCents ?? 0);
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
      <div
        ref={observePhotos}
        {...rotationHandlers}
        className={cn(
          isLarge
            ? cn(LARGE_CARD_IMAGE_CLASS, "bg-brand-50")
            : "relative aspect-[5/4] w-full overflow-hidden rounded-2xl bg-brand-50 shadow-[var(--shadow-card)] ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-[var(--shadow-card-hover)] group-hover:ring-brand-200",
        )}
      >
        <Link
          href={`/listings/${listing.id}${stayQuery}`}
          className={cn("focus-ring absolute inset-0 block", isLarge ? "rounded-[22px]" : "rounded-2xl")}
          onTouchStart={showPhotoControls ? handleTouchStart : undefined}
          onTouchEnd={showPhotoControls ? handleTouchEnd : undefined}
        >
          {photoCount > 0 ? (
            <CrossfadeImages
              photos={listing.photos}
              index={photoIndex}
              previous={previousPhotoIndex}
              preloadNext={preloadNext}
              alt={withCity(listing.title, listing.city)}
              imageClassName="object-cover transition duration-300 group-hover:scale-105"
              sizes={
                isLarge
                  ? "(max-width: 640px) 60vw, (max-width: 1024px) 44vw, 340px"
                  : "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              }
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-brand-300">
              <ImageOff className="h-6 w-6" />
              <span className="text-xs font-medium text-brand-400">Photo coming soon</span>
            </div>
          )}
        </Link>

        {showPhotoControls && (
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
          <span
            className={cn(
              "absolute z-10 rounded-full bg-accent-500 px-2.5 py-1 text-xs font-semibold text-ink shadow-[var(--shadow-card)]",
              isLarge ? "left-3 top-3" : "left-2.5 top-2.5",
            )}
          >
            {dealLabel}
          </span>
        )}

        {promoted && (
          <span
            className={cn(
              "absolute z-10 rounded-md bg-ink/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white backdrop-blur-sm",
              isLarge ? "bottom-3 left-3" : "bottom-2.5 left-2.5",
            )}
          >
            Promoted
          </span>
        )}

        <SaveButton
          listingId={listing.id}
          initialSaved={isSaved}
          isLoggedIn={isLoggedIn}
          className={cn(
            "absolute z-10 h-10 w-10 bg-white/80 shadow-[var(--shadow-card)] backdrop-blur-sm hover:bg-white active:scale-90",
            isLarge ? "right-3 top-3" : "right-2.5 top-2.5",
          )}
        />
      </div>
      <Link
        href={`/listings/${listing.id}${stayQuery}`}
        className={cn("focus-ring flex flex-col gap-2 rounded-xl", isLarge && "px-1 pt-0.5")}
      >
        {/* min-h keeps this row the same height whether the title wraps to
            one line or two, so price/rating rows still line up across a
            row of cards regardless of title length. */}
        <p
          data-testid="listing-card-title"
          className={cn(
            "line-clamp-2 font-semibold leading-snug tracking-tight text-foreground transition-colors duration-200 group-hover:text-brand-800",
            // Large cards show one at a time on phones, so the fixed
            // two-line height (which lines prices up across a row) only
            // applies from sm, where two or more sit side by side.
            isLarge ? "text-base sm:min-h-[3.1rem] sm:text-lg" : "min-h-[2.75rem] text-base",
          )}
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
        {!isLarge && (
          <p className="flex items-center gap-1 text-xs text-stone-500">
            <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {listing.maxGuests} guest{listing.maxGuests === 1 ? "" : "s"}
            <span aria-hidden>·</span>
            {listing.bedrooms} bedroom{listing.bedrooms === 1 ? "" : "s"}
          </p>
        )}
        {!isLarge && keyAmenities.length > 0 && (
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
        <div className={cn("flex items-start justify-between gap-2", isLarge ? "mt-1" : "mt-2.5")}>
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
              {struckNightlyCents !== null && (
                <s className="text-sm tabular-nums text-stone-600">
                  <span className="sr-only">{deal?.kind === "price_drop" ? "Was " : "Full price "}</span>
                  {formattedWasPrice}
                </s>
              )}
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
