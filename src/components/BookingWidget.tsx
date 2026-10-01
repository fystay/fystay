"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type DateRange } from "react-day-picker";
import { format, parseISO, subDays } from "date-fns";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, Lock, MessageCircle, ShieldCheck, Star, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DateRangeField } from "@/components/DateRangeField";
import { GuestCategoryPicker } from "@/components/GuestCategoryPicker";
import { usePromoCode } from "@/hooks/usePromoCode";
import { formatPrice } from "@/lib/format";
import { nightsBetween, rangesOverlap, stayLengthError } from "@/lib/availability";
import type { CancellationPolicy } from "@/lib/cancellationPolicy";
import {
  computeBookingPricing,
  MONTHLY_DISCOUNT_MIN_NIGHTS,
  WEEKLY_DISCOUNT_MIN_NIGHTS,
} from "@/lib/pricing";
import { isPetFriendly, totalOccupants, type GuestCounts } from "@/lib/search";
import type { StaySelection } from "@/lib/stayQuery";
import { HOST_NOT_PAYMENT_READY_MESSAGE } from "@/lib/paymentMessages";

type Props = {
  listingId: string;
  pricePerNightCents: number;
  cleaningFeeCents: number;
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
  minNights: number;
  maxNights: number | null;
  maxGuests: number;
  amenities: string[];
  bookedRanges: { checkIn: string; checkOut: string }[];
  isLoggedIn: boolean;
  rating?: number | null;
  reviewCount?: number;
  cancellationPolicy: CancellationPolicy;
  /** false means this listing is request-to-book: a guest submits a request and the host must accept it before any payment is offered. */
  instantBook: boolean;  /** The stay the guest searched for (see parseStaySelection), so the widget opens with it already selected. */
  initialSelection?: StaySelection;
  /** false when the host can't take a paid booking yet (Stripe payouts not set up) - see hostAcceptsPaidBookings. */
  acceptsPaidBookings?: boolean;
};

/** Guest counts from a search, trimmed to what this listing can actually host. */
function fitGuestsToListing(guests: GuestCounts, capacity: number, petsAllowed: boolean): GuestCounts {
  const adults = Math.min(Math.max(guests.adults, 1), capacity);
  return {
    adults,
    children: Math.min(guests.children, Math.max(capacity - adults, 0)),
    infants: guests.infants,
    pets: petsAllowed ? guests.pets : 0,
  };
}

export function BookingWidget({
  listingId,
  pricePerNightCents,
  cleaningFeeCents,
  weeklyDiscountPercent,
  monthlyDiscountPercent,
  minNights,
  maxNights,
  maxGuests,
  amenities,
  bookedRanges,
  isLoggedIn,
  rating = null,
  reviewCount = 0,
  cancellationPolicy,
  instantBook,
  initialSelection,
  acceptsPaidBookings = true,
}: Props) {
  const router = useRouter();
  const [range, setRange] = useState<DateRange | undefined>(() =>
    initialSelection?.checkIn && initialSelection.checkOut
      ? { from: parseISO(initialSelection.checkIn), to: parseISO(initialSelection.checkOut) }
      : undefined,
  );
  const [guestCounts, setGuestCounts] = useState<GuestCounts>(() =>
    fitGuestsToListing(
      initialSelection?.guests ?? { adults: 1, children: 0, infants: 0, pets: 0 },
      maxGuests,
      isPetFriendly(amenities),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [reserving, setReserving] = useState(false);
  // The selection an availability check last confirmed as free. Compared
  // against the current selection during render (rather than reset via an
  // effect) so changing dates or guests after a successful check
  // automatically requires a fresh check, with no extra state to keep in sync.
  const [checkedSelection, setCheckedSelection] = useState<{
    checkIn: string;
    checkOut: string;
    guests: number;
  } | null>(null);
  const petsAllowed = isPetFriendly(amenities);
  const guests = totalOccupants(guestCounts);

  const parsedBookedRanges = useMemo(
    () =>
      bookedRanges.map((r) => ({
        checkIn: new Date(r.checkIn),
        checkOut: new Date(r.checkOut),
      })),
    [bookedRanges],
  );

  const disabledDays = useMemo(
    () => [{ before: new Date() }, ...parsedBookedRanges.map((r) => ({ from: r.checkIn, to: r.checkOut }))],
    [parsedBookedRanges],
  );

  const nights = range?.from && range?.to ? nightsBetween(range.from, range.to) : 0;

  // The most guest-friendly tier is always authored first (see
  // cancellationPolicy.ts) - once real check-in dates are picked, that
  // turns into a real calendar date rather than just "5 days before
  // check-in", the same way Booking.com/Airbnb show an actual cutoff date
  // instead of leaving a guest to do the maths themselves.
  const bestTier = cancellationPolicy.tiers[0];
  const cancellationCutoffDate =
    range?.from && bestTier && bestTier.refundPercent > 0
      ? subDays(range.from, bestTier.minDaysBeforeCheckIn)
      : null;

  const pricing = computeBookingPricing({
    nights,
    pricePerNightCents,
    cleaningFeeCents,
    weeklyDiscountPercent,
    monthlyDiscountPercent,
  });

  const availabilityChecked = Boolean(
    checkedSelection &&
      range?.from?.toISOString() === checkedSelection.checkIn &&
      range?.to?.toISOString() === checkedSelection.checkOut &&
      guests === checkedSelection.guests,
  );

  const {
    promoCodeInput,
    setPromoCodeInput,
    promoError,
    applyingPromo,
    applyPromoCode,
    clearPromoCode,
    promoActive,
    appliedPromoCode,
    promoDiscountCents,
    promoCodeToSubmit,
  } = usePromoCode({
    listingId,
    buildParams: () =>
      range?.from && range?.to
        ? new URLSearchParams({
            checkIn: range.from.toISOString(),
            checkOut: range.to.toISOString(),
            guests: String(guests),
          })
        : null,
    selectionKey: `${range?.from?.toISOString()}|${range?.to?.toISOString()}|${guests}`,
  });

  function isSelectionValid(): boolean {
    if (!range?.from || !range?.to) return false;
    if (stayLengthError(nightsBetween(range.from, range.to), { minNights, maxNights })) return false;
    return !parsedBookedRanges.some((r) =>
      rangesOverlap(range.from as Date, range.to as Date, r.checkIn, r.checkOut),
    );
  }

  async function handleCheckAvailability() {
    setError(null);

    if (!range?.from || !range?.to) {
      setError("Select your check-in and check-out dates.");
      return;
    }
    const lengthError = stayLengthError(nightsBetween(range.from, range.to), { minNights, maxNights });
    if (lengthError) {
      setError(lengthError);
      return;
    }
    if (!isSelectionValid()) {
      setError("Those dates overlap an existing booking.");
      return;
    }

    setChecking(true);
    try {
      const params = new URLSearchParams({
        checkIn: range.from.toISOString(),
        checkOut: range.to.toISOString(),
        guests: String(guests),
      });
      const res = await fetch(`/api/listings/${listingId}/availability?${params}`);
      const data = await res.json();

      if (!res.ok || !data.available) {
        const message = data.error ?? "Those dates aren't available.";
        setError(message);
        toast.error(message);
        return;
      }

      setCheckedSelection({
        checkIn: range.from.toISOString(),
        checkOut: range.to.toISOString(),
        guests,
      });
      toast.success("Good news — those dates are available.");
    } catch {
      setError("Something went wrong. Please try again.");
      toast.error("Something went wrong. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  async function handleContinueToCheckout() {
    setError(null);
    // The "dates available" toast from the check above (sonner's default
    // duration) would otherwise still be on-screen after this navigates
    // away, rendering on top of the checkout page's own header for
    // whatever's left of its timeout - confirmed happening for a guest who
    // proceeds quickly after checking.
    toast.dismiss();

    if (!range?.from || !range?.to) return;

    setReserving(true);
    try {
      const bookingRes = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          checkIn: range.from.toISOString(),
          checkOut: range.to.toISOString(),
          guests,
          promoCode: promoCodeToSubmit,
        }),
      });
      const bookingData = await bookingRes.json();
      if (!bookingRes.ok) {
        setError(bookingData.error ?? "Could not create booking.");
        toast.error(bookingData.error ?? "Could not create booking.");
        setCheckedSelection(null);
        setReserving(false);
        return;
      }

      if (bookingData.booking.approvalStatus === "AWAITING") {
        toast.success("Request sent - the host has 24 hours to respond.");
        router.push(`/bookings/${bookingData.booking.id}`);
      } else {
        router.push(`/checkout/${bookingData.booking.id}/transfer`);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      toast.error("Something went wrong. Please try again.");
      setReserving(false);
    }
  }

  // Where "Log in to book" sends the guest back to, with the dates and
  // guests they'd picked still selected.
  function listingUrlWithSelection(): string {
    const query = new URLSearchParams();
    if (range?.from && range?.to) {
      query.set("checkIn", format(range.from, "yyyy-MM-dd"));
      query.set("checkOut", format(range.to, "yyyy-MM-dd"));
    }
    if (guestCounts.adults !== 1) query.set("adults", String(guestCounts.adults));
    if (guestCounts.children > 0) query.set("children", String(guestCounts.children));
    if (guestCounts.infants > 0) query.set("infants", String(guestCounts.infants));
    if (guestCounts.pets > 0) query.set("pets", String(guestCounts.pets));
    const serialized = query.toString();
    return `/listings/${listingId}${serialized ? `?${serialized}` : ""}`;
  }

  const hasDates = Boolean(range?.from && range?.to);

  return (
    // lg:sticky (not a plain sticky): on the single-column mobile layout
    // this card sits in normal flow well below the description/amenities/
    // reviews, so a sticky position there would just make it awkwardly
    // pin itself over content while scrolling past, for no benefit -
    // MobileBookingBar is what gives mobile guests a fast way back to it.
    <Card className="p-0 shadow-[var(--shadow-popover)] lg:sticky lg:top-24">
      {/* rounded-t-2xl on the strip itself (matching the Card's own
          rounded-2xl) rather than overflow-hidden on the Card - the Card
          also hosts the Guests popover and the date-range calendar, both
          absolutely positioned and taller than the card, which an
          overflow-hidden ancestor would clip instead of letting them float
          over the page. */}
      <div className="h-1.5 w-full rounded-t-2xl bg-gradient-to-r from-brand-600 via-brand-400 to-accent-400" aria-hidden />
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xl font-bold text-brand-800">
            {formatPrice(pricePerNightCents)}
            <span className="ml-1 text-sm font-normal text-stone-500">/ night</span>
          </p>
          {rating !== null && (
            <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-stone-600">
              <Star className="h-4 w-4 fill-accent-500 text-accent-500" aria-hidden />
              {rating.toFixed(1)}
              {reviewCount > 0 && <span className="text-stone-500">({reviewCount})</span>}
            </span>
          )}
        </div>

        {nights === 0 && (weeklyDiscountPercent || monthlyDiscountPercent) && (
          <p className="mt-1 text-xs font-medium text-brand-700">
            {monthlyDiscountPercent
              ? `${monthlyDiscountPercent}% off stays of ${MONTHLY_DISCOUNT_MIN_NIGHTS}+ nights`
              : `${weeklyDiscountPercent}% off stays of ${WEEKLY_DISCOUNT_MIN_NIGHTS}+ nights`}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <DateRangeField
            range={range}
            onChange={setRange}
            disabledRanges={disabledDays}
            minNights={minNights}
            maxNights={maxNights}
          />
          {nights === 0 && (minNights > 1 || maxNights !== null) && (
            <p className="text-xs text-stone-500">
              {minNights > 1 && maxNights !== null
                ? `${minNights}–${maxNights} night stay`
                : minNights > 1
                  ? `${minNights} night minimum stay`
                  : `${maxNights} night maximum stay`}
            </p>
          )}
          <GuestCategoryPicker
            value={guestCounts}
            onChange={setGuestCounts}
            capacity={maxGuests}
            showPets={petsAllowed}
            triggerClassName="rounded-lg border border-border-subtle px-3 py-2 hover:border-stone-300 hover:bg-transparent"
          />
        </div>

        {nights > 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-4 text-sm text-stone-700">
            <div className="flex justify-between">
              <span>
                {formatPrice(pricePerNightCents)} × {nights} night{nights > 1 ? "s" : ""}
              </span>
              <span>{formatPrice(pricing.nightlySubtotalCents)}</span>
            </div>
            {pricing.lengthOfStayDiscountCents > 0 && (
              <div className="flex justify-between text-brand-700">
                <span>
                  {pricing.lengthOfStayDiscountLabel === "monthly" ? "Monthly" : "Weekly"} discount
                  {" "}({pricing.lengthOfStayDiscountPercent}%)
                </span>
                <span>&minus;{formatPrice(pricing.lengthOfStayDiscountCents)}</span>
              </div>
            )}
            {pricing.cleaningFeeCents > 0 && (
              <div className="flex justify-between">
                <span>Cleaning fee</span>
                <span>{formatPrice(pricing.cleaningFeeCents)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Service fee</span>
              <span>{formatPrice(pricing.serviceFeeCents)}</span>
            </div>
            {promoActive && (
              <div className="flex justify-between text-brand-700">
                <span>Promo code ({appliedPromoCode})</span>
                <span>&minus;{formatPrice(promoDiscountCents)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border-subtle pt-2 font-semibold text-foreground">
              <span>Total</span>
              <span>{formatPrice(pricing.totalPriceCents - promoDiscountCents)}</span>
            </div>
            <p className="text-xs text-stone-500">Taxes aren&apos;t charged today - the total above is everything you pay.</p>

            {availabilityChecked &&
              (promoActive ? (
                <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
                  <span>
                    Promo <strong>{appliedPromoCode}</strong> applied
                  </span>
                  <button type="button" onClick={clearPromoCode} className="underline">
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <Input
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value)}
                      placeholder="Promo code"
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={applyingPromo}
                      onClick={applyPromoCode}
                    >
                      Apply
                    </Button>
                  </div>
                  {promoError && <p className="text-xs text-red-600">{promoError}</p>}
                </div>
              ))}
          </div>
        )}

        {cancellationCutoffDate && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-brand-50 px-3.5 py-3 text-sm text-brand-800">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              <span className="font-semibold">
                {bestTier.refundPercent === 100 ? "Free cancellation" : `${bestTier.refundPercent}% refund`} until{" "}
                {format(cancellationCutoffDate, "d MMM yyyy")}
              </span>
              <br />
              <a href="#cancellation-policy" className="underline underline-offset-2 hover:text-brand-900">
                View cancellation policy
              </a>
            </p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!acceptsPaidBookings ? (
          <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            {HOST_NOT_PAYMENT_READY_MESSAGE}
          </p>
        ) : !isLoggedIn ? (
          <Button
            onClick={() => router.push(`/login?callbackUrl=${encodeURIComponent(listingUrlWithSelection())}`)}
            size="lg"
            className="mt-4 w-full"
          >
            Log in to book
          </Button>
        ) : availabilityChecked ? (
          <Button
            onClick={handleContinueToCheckout}
            loading={reserving}
            size="lg"
            className="mt-4 w-full"
          >
            {instantBook ? "Reserve your stay" : "Request to book"}
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
          </Button>
        ) : (
          <Button
            onClick={handleCheckAvailability}
            loading={checking}
            disabled={!hasDates}
            size="lg"
            className="mt-4 w-full"
          >
            Check dates & price
          </Button>
        )}

        <div className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-4 text-xs text-stone-500">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
            Book with confidence
          </p>
          {isLoggedIn && (
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              {availabilityChecked
                ? instantBook
                  ? "You won't be charged yet"
                  : "You won't be charged unless the host accepts"
                : "We'll confirm your dates are free"}
            </p>
          )}
          {instantBook ? (
            <p className="flex items-center gap-2">
              <Zap className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              Instant Book - no approval needed
            </p>
          ) : (
            <p className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              The host has 24 hours to accept your request
            </p>
          )}
          <p className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            <span>
              <span className="font-medium text-stone-700">{cancellationPolicy.label}</span> cancellation
              -{" "}
              <a href="#cancellation-policy" className="underline hover:text-brand-700">
                see policy
              </a>
            </span>
          </p>
          <p className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            Secure payment via Stripe - we never see your card details
          </p>
          <p className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            Message your host directly once you&apos;re booked
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
