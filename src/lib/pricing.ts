// Platform service fee charged to the guest, on top of the nightly
// subtotal, the same way most OTAs price a stay. Kept as a single named
// constant so the rate lives in one place if it's ever revisited.
export const GUEST_SERVICE_FEE_RATE = 0.1;

/**
 * A nightly rate as guests see it in headlines - on cards, the map, the
 * listing page and search filters: the host's rate plus FYStay's service
 * fee, so the compulsory fee is in the price a guest compares rather than
 * first appearing at checkout (UK DMCC Act). Per-stay charges (cleaning)
 * are shown beside it, and the full breakdown - host rate, service fee,
 * cleaning - stays itemised wherever a total is worked out. The same
 * rounding as the fee on a booking (computeBookingPricing), per night.
 */
export function guestNightlyPriceCents(hostNightlyCents: number): number {
  return hostNightlyCents + Math.round(hostNightlyCents * GUEST_SERVICE_FEE_RATE);
}

// Airbnb-style length-of-stay discount thresholds. A stay only qualifies
// once it meets or exceeds the relevant minimum - a 6-night stay never
// gets the weekly rate, a 27-night stay never gets the monthly one.
export const WEEKLY_DISCOUNT_MIN_NIGHTS = 7;
export const MONTHLY_DISCOUNT_MIN_NIGHTS = 28;

/**
 * Which discount a stay got. "last_minute" is a host's last-minute deal
 * (src/lib/deals.ts), which shares this one discount slot because it never
 * stacks with weekly/monthly - the larger applies.
 */
export type LengthOfStayDiscountLabel = "weekly" | "monthly" | "last_minute";

/** How a stay's discount is named on price breakdowns and receipts. */
export function stayDiscountName(label: string | null | undefined): string {
  if (label === "last_minute") return "Last-minute deal";
  return label === "monthly" ? "Monthly discount" : "Weekly discount";
}

/**
 * Picks which length-of-stay discount (if either) applies to a given stay.
 * Monthly takes priority at 28+ nights when the host has set one, since a
 * host who bothers configuring both rates means the monthly one for their
 * longest stays; a stay of 28+ nights still falls back to the weekly rate
 * if no monthly rate is set, rather than getting no discount at all.
 */
export function resolveLengthOfStayDiscount(params: {
  nights: number;
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
}): { percent: number; label: LengthOfStayDiscountLabel | null } {
  const { nights, weeklyDiscountPercent, monthlyDiscountPercent } = params;

  if (nights >= MONTHLY_DISCOUNT_MIN_NIGHTS && monthlyDiscountPercent) {
    return { percent: monthlyDiscountPercent, label: "monthly" };
  }
  if (nights >= WEEKLY_DISCOUNT_MIN_NIGHTS && weeklyDiscountPercent) {
    return { percent: weeklyDiscountPercent, label: "weekly" };
  }
  return { percent: 0, label: null };
}

export type BookingPriceBreakdown = {
  /** Gross, before any length-of-stay discount: nights * pricePerNightCents. */
  nightlySubtotalCents: number;
  lengthOfStayDiscountPercent: number;
  lengthOfStayDiscountCents: number;
  lengthOfStayDiscountLabel: LengthOfStayDiscountLabel | null;
  cleaningFeeCents: number;
  serviceFeeCents: number;
  taxCents: number;
  totalPriceCents: number;
};

/**
 * The single source of truth for turning a stay length + a listing's rates
 * into what the guest actually owes. Used both to preview a price before a
 * booking exists (the widget, the availability check) and to snapshot a
 * price onto a booking at creation time, so the two can never disagree.
 *
 * taxCents is always 0 today: FYStay doesn't yet compute jurisdiction-
 * specific occupancy tax, so it isn't fabricated here. The field exists so
 * the breakdown (and the UI line for it) is ready the moment that logic
 * exists, without another schema change.
 */
export function computeBookingPricing(params: {
  nights: number;
  pricePerNightCents: number;
  cleaningFeeCents?: number;
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
  /**
   * The last-minute deal this stay qualifies for (see lastMinuteDiscountFor
   * in src/lib/deals.ts - the caller decides from the check-in date). Used
   * instead of the weekly/monthly discount only when it's larger.
   */
  lastMinuteDiscountPercent?: number | null;
}): BookingPriceBreakdown {
  const {
    nights,
    pricePerNightCents,
    cleaningFeeCents = 0,
    weeklyDiscountPercent,
    monthlyDiscountPercent,
    lastMinuteDiscountPercent,
  } = params;
  const nightlySubtotalCents = Math.max(0, nights) * pricePerNightCents;
  const lengthOfStay = resolveLengthOfStayDiscount({ nights, weeklyDiscountPercent, monthlyDiscountPercent });
  const { percent: lengthOfStayDiscountPercent, label: lengthOfStayDiscountLabel } =
    lastMinuteDiscountPercent && lastMinuteDiscountPercent > lengthOfStay.percent
      ? { percent: lastMinuteDiscountPercent, label: "last_minute" as const }
      : lengthOfStay;
  const lengthOfStayDiscountCents = Math.round(
    (nightlySubtotalCents * lengthOfStayDiscountPercent) / 100,
  );
  const discountedNightlySubtotalCents = nightlySubtotalCents - lengthOfStayDiscountCents;
  const serviceFeeCents = Math.round(discountedNightlySubtotalCents * GUEST_SERVICE_FEE_RATE);
  const taxCents = 0;
  const totalPriceCents =
    discountedNightlySubtotalCents + cleaningFeeCents + serviceFeeCents + taxCents;

  return {
    nightlySubtotalCents,
    lengthOfStayDiscountPercent,
    lengthOfStayDiscountCents,
    lengthOfStayDiscountLabel,
    cleaningFeeCents,
    serviceFeeCents,
    taxCents,
    totalPriceCents,
  };
}

/**
 * The most referral credit and promo discount one booking can take
 * together: FYStay's own fee on it. Both are FYStay's marketing cost, paid
 * out of that fee (applyDiscountsToApplicationFee) - a larger discount
 * would come out of the host's payout instead, breaking the promise that
 * the host earns exactly their price. Unused credit stays on the guest's
 * account for their next stay.
 */
export function maxFyStayDiscountCents(pricing: { serviceFeeCents: number; taxCents: number }): number {
  return Math.max(0, pricing.serviceFeeCents + pricing.taxCents);
}

/**
 * Referral credit and a promo code's discount (see referral.ts and
 * promoCode.ts) are both FYStay's own marketing cost, not the host's to
 * bear - so together they come out of the platform's own
 * applicationFeeCents. maxFyStayDiscountCents keeps new bookings within
 * it; the floor here only matters for bookings made before that cap.
 */
export function applyDiscountsToApplicationFee(
  grossApplicationFeeCents: number,
  discountsCents: number,
): number {
  return Math.max(0, grossApplicationFeeCents - discountsCents);
}

/**
 * What a booking's stay itself costs once any weekly/monthly discount is
 * taken off - the accommodation line the guest is charged at checkout. The
 * booking stores the gross nightly rate and the discount separately, so
 * charging nights x nightly rate alone would bill the guest (and pass to
 * the host) the undiscounted price instead of the total they were shown.
 */
export function discountedAccommodationCents(booking: {
  nights: number;
  nightlyPriceCents: number;
  lengthOfStayDiscountCents: number;
}): number {
  return booking.nights * booking.nightlyPriceCents - booking.lengthOfStayDiscountCents;
}

export type ChangeSplitBooking = {
  totalPriceCents: number;
  cleaningFeeCents: number;
  serviceFeeCents: number;
  taxCents: number;
  creditAppliedCents: number;
  promoDiscountCents: number;
};

/**
 * Splits a booking change's price difference (extra owed, or refunded when
 * negative) into the host's accommodation share and FYStay's service-fee
 * share, using computeBookingPricing itself - the same rule that priced the
 * booking - rather than a separate approximation.
 *
 * A change only moves the accommodation amount (more or fewer nights);
 * cleaning, tax and discounts are per stay and don't move with it. So the
 * new accommodation amount is the one whose accommodation + service fee
 * covers the booking's current accommodation + fee + the difference, and
 * FYStay's share is how much the service fee moves with it. The current
 * accommodation is read from the booking's own totals rather than
 * nights x nightly price, so it stays correct after earlier changes too.
 */
export function splitBookingChange(
  deltaCents: number,
  booking: ChangeSplitBooking,
): { hostShareCents: number; platformShareCents: number } {
  const currentAccommodationCents =
    booking.totalPriceCents +
    booking.creditAppliedCents +
    booking.promoDiscountCents -
    booking.cleaningFeeCents -
    booking.serviceFeeCents -
    booking.taxCents;
  const targetCents = currentAccommodationCents + booking.serviceFeeCents + deltaCents;
  const serviceFeeFor = (accommodationCents: number) =>
    computeBookingPricing({ nights: 1, pricePerNightCents: accommodationCents }).serviceFeeCents;

  // fee = round(accommodation * rate), so accommodation + fee is
  // non-decreasing and steps by 1-2p: an exact match is within a few pence
  // of the straight division. Closest match wins if rounding skips over it.
  const estimate = Math.max(0, Math.round(targetCents / (1 + GUEST_SERVICE_FEE_RATE)));
  let newAccommodationCents = estimate;
  let bestGap = Infinity;
  for (let candidate = Math.max(0, estimate - 3); candidate <= estimate + 3; candidate++) {
    const gap = Math.abs(candidate + serviceFeeFor(candidate) - targetCents);
    if (gap < bestGap) {
      bestGap = gap;
      newAccommodationCents = candidate;
    }
  }

  const rawPlatformShare = serviceFeeFor(newAccommodationCents) - booking.serviceFeeCents;
  // Never more than the difference itself, in either direction.
  const platformShareCents =
    deltaCents >= 0
      ? Math.min(Math.max(rawPlatformShare, 0), deltaCents)
      : Math.max(Math.min(rawPlatformShare, 0), deltaCents);
  return { hostShareCents: deltaCents - platformShareCents, platformShareCents };
}
