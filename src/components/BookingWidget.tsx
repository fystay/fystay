"use client";

import { useMemo, useRef, useState } from "react";
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
import { MobileBookingBar, scrollToBookingWidget } from "@/components/MobileBookingBar";
import { usePromoCode } from "@/hooks/usePromoCode";
import { formatPrice } from "@/lib/format";
import { nightsBetween, rangesOverlap, stayLengthError } from "@/lib/availability";
import type { CancellationPolicy } from "@/lib/cancellationPolicy";
import {
  computeBookingPricing,
  MONTHLY_DISCOUNT_MIN_NIGHTS,
  stayDiscountName,
  WEEKLY_DISCOUNT_MIN_NIGHTS,
  guestNightlyPriceCents,
  nightlyChargeLines,
  stayRates,
} from "@/lib/pricing";
import { lastMinuteDiscountFor } from "@/lib/deals";
import { isPetFriendly, totalOccupants, type GuestCounts } from "@/lib/search";
import type { StaySelection } from "@/lib/stayQuery";
import { HOST_NOT_PAYMENT_READY_MESSAGE } from "@/lib/paymentMessages";
import { parseStayDate, stayDateToLocal, toStayDateString } from "@/lib/stayDates";

type Props = {
  listingId: string;
  pricePerNightCents: number;
  /** Friday/Saturday rate, when the host charges one (never below pricePerNightCents). */
  weekendPricePerNightCents?: number | null;
  cleaningFeeCents: number;
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
  /** The listing's last-minute deal (see src/lib/deals.ts), applied when the chosen check-in is within the window. */
  lastMinuteDiscountPercent?: number | null;
  lastMinuteWindowDays?: number | null;
  /** The genuine earlier nightly price while a price drop is live (activePriceDrop), shown struck through. */
  priceDropFromCents?: number | null;
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
  /** A refundable card hold placed before check-in (securityDeposit.ts) - told up front so it isn't a surprise at checkout. */
  securityDepositCents?: number;
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
  weekendPricePerNightCents = null,
  cleaningFeeCents,
  weeklyDiscountPercent,
  monthlyDiscountPercent,
  lastMinuteDiscountPercent = null,
  lastMinuteWindowDays = null,
  priceDropFromCents = null,
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
  securityDepositCents = 0,
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
  const [reserving, setReserving] = useState(false);
  // Set synchronously on the first press, before React re-renders with
  // reserving=true, so a fast double-tap can't send two requests (the server
  // would hand back the same held booking anyway - see POST /api/bookings).
  const reservingRef = useRef(false);
  const [showPromo, setShowPromo] = useState(false);
  const petsAllowed = isPetFriendly(amenities);
  const guests = totalOccupants(guestCounts);

  const parsedBookedRanges = useMemo(
    () =>
      bookedRanges.map((r) => ({
        checkIn: stayDateToLocal(r.checkIn),
        checkOut: stayDateToLocal(r.checkOut),
      })),
    [bookedRanges],
  );

  const disabledDays = useMemo(
    () => [{ before: new Date() }, ...parsedBookedRanges.map((r) => ({ from: r.checkIn, to: r.checkOut }))],
    [parsedBookedRanges],
  );

  const nights = range?.from && range?.to ? nightsBetween(range.from, range.to) : 0;
  const hasWeekendRate = weekendPricePerNightCents !== null && weekendPricePerNightCents !== pricePerNightCents;

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

  // The same rule the server charges by (POST /api/bookings), from the
  // picked check-in as a calendar date.
  const selectedCheckIn = range?.from ? parseStayDate(toStayDateString(range.from)) : null;
  const lastMinuteForStay = selectedCheckIn
    ? lastMinuteDiscountFor({ lastMinuteDiscountPercent, lastMinuteWindowDays }, selectedCheckIn)
    : null;
  const selectedCheckOut = range?.to ? parseStayDate(toStayDateString(range.to)) : null;
  const pricing = computeBookingPricing({
    nights,
    ...(selectedCheckIn && selectedCheckOut
      ? stayRates({ pricePerNightCents, weekendPricePerNightCents }, selectedCheckIn, selectedCheckOut)
      : { pricePerNightCents }),
    cleaningFeeCents,
    weeklyDiscountPercent,
    monthlyDiscountPercent,
    lastMinuteDiscountPercent: lastMinuteForStay,
  });

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
            checkIn: toStayDateString(range.from),
            checkOut: toStayDateString(range.to),
            guests: String(guests),
          })
        : null,
    selectionKey: `${(range?.from && toStayDateString(range.from))}|${(range?.to && toStayDateString(range.to))}|${guests}`,
  });

  function isSelectionValid(): boolean {
    if (!range?.from || !range?.to) return false;
    if (stayLengthError(nightsBetween(range.from, range.to), { minNights, maxNights })) return false;
    return !parsedBookedRanges.some((r) =>
      rangesOverlap(range.from as Date, range.to as Date, r.checkIn, r.checkOut),
    );
  }

  function openCalendar() {
    scrollToBookingWidget();
    // After the scroll has started, so the calendar opens where the guest is looking.
    window.setTimeout(() => document.getElementById("booking-dates")?.click(), 350);
  }

  /**
   * One press from chosen dates to checkout: the price is already on screen
   * (computeBookingPricing, the same rule the server charges by), and POST
   * /api/bookings re-checks availability itself inside a serializable
   * transaction - so there's no separate "check" step to sit through.
   */
  async function handleReserve() {
    if (reservingRef.current) return;
    setError(null);
    // The "dates are free" style toasts from an earlier attempt would
    // otherwise still be on screen over the next page's header.
    toast.dismiss();

    if (!range?.from || !range?.to) {
      openCalendar();
      return;
    }
    const lengthError = stayLengthError(nightsBetween(range.from, range.to), { minNights, maxNights });
    if (lengthError) {
      setError(lengthError);
      scrollToBookingWidget();
      return;
    }
    if (!isSelectionValid()) {
      setError("Those dates overlap an existing booking - please choose different dates.");
      scrollToBookingWidget();
      return;
    }

    reservingRef.current = true;
    setReserving(true);
    try {
      const bookingRes = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          checkIn: toStayDateString(range.from),
          checkOut: toStayDateString(range.to),
          guests,
          promoCode: promoCodeToSubmit,
        }),
      });
      const bookingData = await bookingRes.json().catch(() => null);
      if (!bookingRes.ok || !bookingData?.booking) {
        const message = bookingData?.error ?? "We couldn't reserve those dates. Please try again.";
        setError(message);
        toast.error(message);
        scrollToBookingWidget();
        reservingRef.current = false;
        setReserving(false);
        return;
      }

      if (bookingData.booking.approvalStatus === "AWAITING") {
        toast.success("Request sent - the host has 24 hours to respond.");
        router.push(`/bookings/${bookingData.booking.id}`);
      } else {
        router.push(`/checkout/${bookingData.booking.id}`);
      }
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
      toast.error("Something went wrong. Please try again.");
      reservingRef.current = false;
      setReserving(false);
    }
  }

  function goToLogin() {
    router.push(`/login?callbackUrl=${encodeURIComponent(listingUrlWithSelection())}`);
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
    // the MobileBookingBar below is what gives mobile guests a fast way back to it.
    <>
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
              {priceDropFromCents && (
                <s className="mr-1.5 text-base font-medium text-stone-600">
                  <span className="sr-only">Was </span>
                  {formatPrice(guestNightlyPriceCents(priceDropFromCents))}
                </s>
              )}
              {hasWeekendRate && <span className="mr-1 text-sm font-normal text-stone-500">from</span>}
              {formatPrice(guestNightlyPriceCents(pricePerNightCents))}
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
          {/* The headline already includes FYStay's service fee; say so, and
              name the one per-stay charge it can't include per night. */}
          <p className="mt-0.5 text-xs text-stone-500">
            Includes FYStay&apos;s service fee
            {hasWeekendRate && ` · ${formatPrice(guestNightlyPriceCents(weekendPricePerNightCents!))} on Fri and Sat nights`}
            {cleaningFeeCents > 0 && ` · plus ${formatPrice(cleaningFeeCents)} cleaning per stay`}
          </p>

          {lastMinuteDiscountPercent && lastMinuteWindowDays && (
            <p className="mt-1 text-xs font-semibold text-brand-700">
              Last-minute deal: {lastMinuteDiscountPercent}% off if you check in within {lastMinuteWindowDays} days
            </p>
          )}

          {nights === 0 && (weeklyDiscountPercent || monthlyDiscountPercent) && (
            <p className="mt-1 text-xs font-medium text-brand-700">
              {monthlyDiscountPercent
                ? `${monthlyDiscountPercent}% off stays of ${MONTHLY_DISCOUNT_MIN_NIGHTS}+ nights`
                : `${weeklyDiscountPercent}% off stays of ${WEEKLY_DISCOUNT_MIN_NIGHTS}+ nights`}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <DateRangeField
              id="booking-dates"
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
              {nightlyChargeLines(
                {
                  nights,
                  nightlyPriceCents: pricePerNightCents,
                  weekendNights: pricing.weekendNights,
                  weekendNightlyPriceCents: pricing.weekendNightlyPriceCents,
                },
                formatPrice,
              ).map((line) => (
                <div key={line.label} className="flex justify-between">
                  <span>{line.label}</span>
                  <span>{formatPrice(line.cents)}</span>
                </div>
              ))}
              {pricing.lengthOfStayDiscountCents > 0 && (
                <div className="flex justify-between text-brand-700">
                  <span>
                    {stayDiscountName(pricing.lengthOfStayDiscountLabel)} ({pricing.lengthOfStayDiscountPercent}%)
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
              <p className="text-xs text-stone-500">
                Taxes aren&apos;t charged today - the total above is everything you pay.
                {securityDepositCents > 0 &&
                  ` The host also asks for a refundable ${formatPrice(securityDepositCents)} security deposit: a hold on your card the day before check-in, released after your stay unless there's damage.`}
              </p>

              {isLoggedIn &&
                (promoActive ? (
                  <div className="flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
                    <span>
                      Promo <strong>{appliedPromoCode}</strong> applied
                    </span>
                    <button type="button" onClick={clearPromoCode} className="underline">
                      Remove
                    </button>
                  </div>
                ) : !showPromo ? (
                  <button
                    type="button"
                    onClick={() => setShowPromo(true)}
                    className="focus-ring self-start rounded-sm text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
                  >
                    Have a promo code?
                  </button>
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
            <>
              <Button onClick={goToLogin} size="lg" className="mt-4 w-full">
                Log in to book
              </Button>
              <p className="mt-2 text-center text-xs text-stone-500">
                Booking needs a free FYStay account - it keeps your booking, receipt and host messages
                together. New here? Sign up in a minute and we&apos;ll bring you straight back.
              </p>
            </>
          ) : (
            <Button onClick={handleReserve} loading={reserving} size="lg" className="mt-4 w-full">
              {!hasDates ? "Choose your dates" : instantBook ? "Reserve your stay" : "Request to book"}
              {hasDates && <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />}
            </Button>
          )}

          <div className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-4 text-xs text-stone-500">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              Book with confidence
            </p>
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              {instantBook
                ? "You won't be charged until you pay on the next page"
                : "You won't be charged unless the host accepts"}
            </p>
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

      <MobileBookingBar
        amount={
          hasDates ? (
            <>
              <span className="font-bold text-brand-800">
                {formatPrice(pricing.totalPriceCents - promoDiscountCents)}
              </span>{" "}
              <span className="text-sm text-stone-500">total</span>
            </>
          ) : (
            <>
              {hasWeekendRate && <span className="text-sm text-stone-500">from </span>}
              <span className="font-bold text-brand-800">{formatPrice(guestNightlyPriceCents(pricePerNightCents))}</span>{" "}
              <span className="text-sm text-stone-500">/ night incl. service fee</span>
            </>
          )
        }
        detail={
          hasDates && range?.from && range?.to
            ? `${format(range.from, "d MMM")} - ${format(range.to, "d MMM")} · ${nights} night${nights === 1 ? "" : "s"}`
            : undefined
        }
        actionLabel={
          !acceptsPaidBookings
            ? "See details"
            : !isLoggedIn
              ? hasDates
                ? "Log in"
                : "Add dates"
              : !hasDates
                ? "Add dates"
                : instantBook
                  ? "Reserve"
                  : "Request"
        }
        onAction={
          !acceptsPaidBookings
            ? scrollToBookingWidget
            : !hasDates
              ? openCalendar
              : !isLoggedIn
                ? goToLogin
                : handleReserve
        }
        loading={reserving}
      />
    </>
  );
}
