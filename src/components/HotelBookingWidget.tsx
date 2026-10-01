"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { type DateRange } from "react-day-picker";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { ArrowRight, BedDouble, ImageOff, Lock, Minus, Plus, ShieldCheck, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DateRangeField } from "@/components/DateRangeField";
import { usePromoCode } from "@/hooks/usePromoCode";
import { formatPrice } from "@/lib/format";
import { nightsBetween, stayLengthError } from "@/lib/availability";
import type { CancellationPolicy } from "@/lib/cancellationPolicy";
import { computeBookingPricing } from "@/lib/pricing";
import { isOptimizableImage } from "@/lib/image";
import { cn } from "@/lib/cn";
import type { StaySelection } from "@/lib/stayQuery";

export type HotelRoomTypeSummary = {
  id: string;
  name: string;
  description: string | null;
  pricePerNightCents: number;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  photos: string[];
  totalRooms: number;
};

type Props = {
  listingId: string;
  roomTypes: HotelRoomTypeSummary[];
  cleaningFeeCents: number;
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
  minNights: number;
  maxNights: number | null;
  isLoggedIn: boolean;
  cancellationPolicy: CancellationPolicy;
  /** false means this listing is request-to-book: a guest submits a request and the host must accept it before any payment is offered. */
  instantBook: boolean;
  /** The stay the guest searched for (see parseStaySelection), so dates and guests open already selected. */
  initialSelection?: StaySelection;
};

function Stepper({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
      <span className="text-sm text-stone-600">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-full border border-border-subtle text-stone-600 hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-5 text-center text-sm font-medium tabular-nums text-foreground">{value}</span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-full border border-border-subtle text-stone-600 hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * The HOTEL analogue of BookingWidget: one shared date range (dates apply
 * regardless of which room type a guest ultimately picks - standard hotel-
 * site UX), a list of room types with their own price/capacity, and the
 * same two-step "check availability -> reserve/request" flow per room
 * type, just carrying roomTypeId + roomsBooked instead of listingId.
 * Deliberately one room type per booking (confirmed product decision) -
 * booking two different room types is two separate reservations.
 */
export function HotelBookingWidget({
  listingId,
  roomTypes,
  cleaningFeeCents,
  weeklyDiscountPercent,
  monthlyDiscountPercent,
  minNights,
  maxNights,
  isLoggedIn,
  cancellationPolicy,
  instantBook,
  initialSelection,
}: Props) {
  const [range, setRange] = useState<DateRange | undefined>(() =>
    initialSelection?.checkIn && initialSelection.checkOut
      ? { from: parseISO(initialSelection.checkIn), to: parseISO(initialSelection.checkOut) }
      : undefined,
  );
  // Adults + children searched for, if any - each room type starts at that
  // (capped to what the room sleeps) instead of its maximum.
  const searchedGuests = initialSelection
    ? Math.max(initialSelection.guests.adults + initialSelection.guests.children, 1)
    : null;
  // Where "Log in to book" sends the guest back to, keeping the dates picked.
  const loginHref = (() => {
    const query = new URLSearchParams();
    if (range?.from && range?.to) {
      query.set("checkIn", format(range.from, "yyyy-MM-dd"));
      query.set("checkOut", format(range.to, "yyyy-MM-dd"));
    }
    if (searchedGuests && searchedGuests !== 1) query.set("adults", String(searchedGuests));
    const serialized = query.toString();
    return `/login?callbackUrl=${encodeURIComponent(`/listings/${listingId}${serialized ? `?${serialized}` : ""}`)}`;
  })();
  const disabledDays = useMemo(() => [{ before: new Date() }], []);
  const nights = range?.from && range?.to ? nightsBetween(range.from, range.to) : 0;
  const lengthError = nights > 0 ? stayLengthError(nights, { minNights, maxNights }) : null;
  const cheapestPrice = Math.min(...roomTypes.map((rt) => rt.pricePerNightCents));

  return (
    <Card className="p-0 shadow-[var(--shadow-popover)] lg:sticky lg:top-24">
      <div
        className="h-1.5 w-full rounded-t-2xl bg-gradient-to-r from-brand-600 via-brand-400 to-accent-400"
        aria-hidden
      />
      <CardContent className="p-5 sm:p-6">
        <p className="text-2xl font-bold text-brand-800">
          {formatPrice(cheapestPrice)}
          <span className="ml-1 text-sm font-normal text-stone-500">/ night from</span>
        </p>

        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-foreground">Dates</p>
          <DateRangeField
            range={range}
            onChange={setRange}
            disabledRanges={disabledDays}
            minNights={minNights}
            maxNights={maxNights}
          />
          {nights === 0 && (minNights > 1 || maxNights !== null) && (
            <p className="mt-1 text-xs text-stone-500">
              {minNights > 1 && maxNights !== null
                ? `${minNights}–${maxNights} night stay`
                : minNights > 1
                  ? `${minNights} night minimum stay`
                  : `${maxNights} night maximum stay`}
            </p>
          )}
          {lengthError && <p className="mt-2 text-sm text-red-600">{lengthError}</p>}
        </div>

        <div className="mt-5 flex flex-col gap-4 border-t border-border-subtle pt-5">
          <p className="text-sm font-semibold text-foreground">Choose a room type</p>
          {roomTypes.map((roomType) => (
            <RoomTypeBookingCard
              key={roomType.id}
              listingId={listingId}
              roomType={roomType}
              range={nights > 0 && !lengthError ? range : undefined}
              cleaningFeeCents={cleaningFeeCents}
              weeklyDiscountPercent={weeklyDiscountPercent}
              monthlyDiscountPercent={monthlyDiscountPercent}
              isLoggedIn={isLoggedIn}
              instantBook={instantBook}
              initialGuests={searchedGuests}
              loginHref={loginHref}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-2 border-t border-border-subtle pt-4 text-xs text-stone-500">
          <p className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            {instantBook
              ? "You won't be charged yet"
              : "You won't be charged unless the host accepts"}
          </p>
          <p className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            Secure payment via Stripe - we never see your card details
          </p>
          <p>
            <span className="font-medium text-stone-700">{cancellationPolicy.label}</span>{" "}
            cancellation -{" "}
            <a href="#cancellation-policy" className="underline hover:text-brand-700">
              see policy
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function RoomTypeBookingCard({
  listingId,
  roomType,
  range,
  cleaningFeeCents,
  weeklyDiscountPercent,
  monthlyDiscountPercent,
  isLoggedIn,
  instantBook,
  initialGuests,
  loginHref,
}: {
  listingId: string;
  roomType: HotelRoomTypeSummary;
  range: DateRange | undefined;
  cleaningFeeCents: number;
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
  isLoggedIn: boolean;
  instantBook: boolean;
  initialGuests: number | null;
  loginHref: string;
}) {
  const router = useRouter();
  const [roomsBooked, setRoomsBooked] = useState(1);
  const [guests, setGuests] = useState(() =>
    initialGuests ? Math.min(initialGuests, roomType.maxGuests) : roomType.maxGuests,
  );
  const [checking, setChecking] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedSelection, setCheckedSelection] = useState<{
    checkIn: string;
    checkOut: string;
    guests: number;
    roomsBooked: number;
  } | null>(null);

  const nights = range?.from && range?.to ? nightsBetween(range.from, range.to) : 0;
  const pricing =
    nights > 0
      ? computeBookingPricing({
          nights,
          pricePerNightCents: roomType.pricePerNightCents * roomsBooked,
          cleaningFeeCents,
          weeklyDiscountPercent,
          monthlyDiscountPercent,
        })
      : null;

  const availabilityChecked = Boolean(
    checkedSelection &&
      range?.from?.toISOString() === checkedSelection.checkIn &&
      range?.to?.toISOString() === checkedSelection.checkOut &&
      guests === checkedSelection.guests &&
      roomsBooked === checkedSelection.roomsBooked,
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
            roomTypeId: roomType.id,
            roomsBooked: String(roomsBooked),
          })
        : null,
    selectionKey: `${range?.from?.toISOString()}|${range?.to?.toISOString()}|${guests}|${roomsBooked}`,
  });

  function updateRoomsBooked(next: number) {
    setRoomsBooked(next);
    setGuests((g) => Math.min(g, roomType.maxGuests * next));
  }

  async function handleCheckAvailability() {
    setError(null);
    if (!range?.from || !range?.to) {
      setError("Select your dates above first.");
      return;
    }

    setChecking(true);
    try {
      const params = new URLSearchParams({
        checkIn: range.from.toISOString(),
        checkOut: range.to.toISOString(),
        guests: String(guests),
        roomTypeId: roomType.id,
        roomsBooked: String(roomsBooked),
      });
      const res = await fetch(`/api/listings/${listingId}/availability?${params}`);
      const data = await res.json();

      if (!res.ok || !data.available) {
        const message = data.error ?? "Those dates aren't available for this room type.";
        setError(message);
        toast.error(message);
        return;
      }

      setCheckedSelection({
        checkIn: range.from.toISOString(),
        checkOut: range.to.toISOString(),
        guests,
        roomsBooked,
      });
      toast.success("Good news — this room type is available.");
    } catch {
      setError("Something went wrong. Please try again.");
      toast.error("Something went wrong. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  async function handleContinueToCheckout() {
    setError(null);
    // See BookingWidget.tsx's own copy of this same fix: without it, the
    // "this room type is available" toast from the check above can still
    // be on-screen after navigating to checkout.
    toast.dismiss();
    if (!range?.from || !range?.to) return;

    setReserving(true);
    try {
      const bookingRes = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomTypeId: roomType.id,
          roomsBooked,
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

  return (
    <div className={cn("rounded-xl border p-3", "border-border-subtle")}>
      <div className="flex gap-3">
        <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
          {roomType.photos[0] ? (
            <Image
              src={roomType.photos[0]}
              alt={roomType.name}
              fill
              className="object-cover"
              sizes="80px"
              unoptimized={!isOptimizableImage(roomType.photos[0])}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-stone-400">
              <ImageOff className="h-4 w-4" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{roomType.name}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> Up to {roomType.maxGuests} guest
              {roomType.maxGuests > 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <BedDouble className="h-3.5 w-3.5" /> {roomType.beds} bed{roomType.beds > 1 ? "s" : ""}
            </span>
          </p>
          <p className="mt-1 text-sm font-semibold text-brand-800">
            {formatPrice(roomType.pricePerNightCents)}
            <span className="font-normal text-stone-500"> / night</span>
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Stepper
          label="Rooms"
          value={roomsBooked}
          onChange={updateRoomsBooked}
          min={1}
          max={roomType.totalRooms}
        />
        <Stepper
          label="Guests"
          value={guests}
          onChange={setGuests}
          min={1}
          max={roomType.maxGuests * roomsBooked}
        />
      </div>

      {pricing && nights > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-border-subtle pt-3 text-sm text-stone-700">
          <div className="flex justify-between">
            <span>
              {formatPrice(roomType.pricePerNightCents * roomsBooked)} × {nights} night
              {nights > 1 ? "s" : ""}
            </span>
            <span>{formatPrice(pricing.nightlySubtotalCents)}</span>
          </div>
          {pricing.lengthOfStayDiscountCents > 0 && (
            <div className="flex justify-between text-brand-700">
              <span>
                {pricing.lengthOfStayDiscountLabel === "monthly" ? "Monthly" : "Weekly"} discount (
                {pricing.lengthOfStayDiscountPercent}%)
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
          <div className="flex justify-between border-t border-border-subtle pt-1.5 font-semibold text-foreground">
            <span>Total</span>
            <span>{formatPrice(pricing.totalPriceCents - promoDiscountCents)}</span>
          </div>

          {availabilityChecked &&
            (promoActive ? (
              <div className="flex items-center justify-between rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs text-brand-800">
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

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3">
        {!isLoggedIn ? (
          <Button
            onClick={() => router.push(loginHref)}
            size="sm"
            className="w-full"
          >
            Log in to book
          </Button>
        ) : availabilityChecked ? (
          <Button onClick={handleContinueToCheckout} loading={reserving} size="sm" className="w-full">
            {instantBook ? "Reserve" : "Request to book"}
            <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
          </Button>
        ) : (
          <Button
            onClick={handleCheckAvailability}
            loading={checking}
            disabled={!range}
            size="sm"
            variant="secondary"
            className="w-full"
          >
            Check availability & price
          </Button>
        )}
      </div>
    </div>
  );
}
