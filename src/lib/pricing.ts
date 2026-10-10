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

/**
 * Friday and Saturday nights - the nights a weekend rate applies to (the
 * usual UK holiday-let and OTA meaning). A stay date is a UTC-midnight
 * calendar date (see stayDates.ts), and the night belongs to the date it
 * starts on: a Friday check-in's first night is a weekend night, a Sunday
 * check-in's isn't.
 */
export function isWeekendNight(night: Date): boolean {
  const day = night.getUTCDay();
  return day === 5 || day === 6;
}

/** How many of the nights from checkIn up to (not including) checkOut are weekend nights. */
export function weekendNightsBetween(checkIn: Date, checkOut: Date): number {
  let count = 0;
  for (let night = checkIn.getTime(); night < checkOut.getTime(); night += 24 * 60 * 60 * 1000) {
    if (isWeekendNight(new Date(night))) count++;
  }
  return count;
}

/**
 * A listing's rates for one stay, ready for computeBookingPricing: its
 * weekday rate, its weekend rate (if it has one) and how many weekend nights
 * the dates contain. The one place a listing's weekend rate meets a stay's
 * dates, so the quote, the booking and its snapshot agree.
 */
export function stayRates(
  listing: { pricePerNightCents: number; weekendPricePerNightCents?: number | null },
  checkIn: Date,
  checkOut: Date,
): { pricePerNightCents: number; weekendPricePerNightCents: number | null; weekendNights: number } {
  const weekendPricePerNightCents = listing.weekendPricePerNightCents ?? null;
  return {
    pricePerNightCents: listing.pricePerNightCents,
    weekendPricePerNightCents,
    weekendNights: weekendPricePerNightCents === null ? 0 : weekendNightsBetween(checkIn, checkOut),
  };
}

/**
 * A booking's gross accommodation, before its stay discount: weekday nights
 * at its nightly rate and weekend nights at its weekend rate, both as copied
 * when it was booked. Every booking from before weekend rates has
 * weekendNights 0, so this is nights x nightlyPriceCents for those.
 */
export function bookingNightlySubtotalCents(booking: {
  nights: number;
  nightlyPriceCents: number;
  weekendNights?: number | null;
  weekendNightlyPriceCents?: number | null;
}): number {
  return nightlySubtotal(booking.nights, booking.nightlyPriceCents, booking.weekendNights, booking.weekendNightlyPriceCents);
}

function nightlySubtotal(
  nights: number,
  pricePerNightCents: number,
  weekendNights: number | null | undefined,
  weekendPricePerNightCents: number | null | undefined,
): number {
  const allNights = Math.max(0, nights);
  const atWeekendRate =
    weekendPricePerNightCents === null || weekendPricePerNightCents === undefined
      ? 0
      : Math.min(allNights, Math.max(0, weekendNights ?? 0));
  return (allNights - atWeekendRate) * pricePerNightCents + atWeekendRate * (weekendPricePerNightCents ?? 0);
}

export type BookingPriceBreakdown = {
  /** Gross, before any length-of-stay discount: weekday nights at the nightly rate plus weekend nights at the weekend rate. */
  nightlySubtotalCents: number;
  /** Nights charged at weekendNightlyPriceCents; 0 when the stay has none or the listing has no weekend rate. */
  weekendNights: number;
  /** The weekend rate the stay was priced with, copied onto the booking; null when the listing has none. */
  weekendNightlyPriceCents: number | null;
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
  /** The listing's Friday/Saturday rate (see stayRates); omitted or null means every night is pricePerNightCents. */
  weekendPricePerNightCents?: number | null;
  /** How many of the nights are Friday or Saturday nights (weekendNightsBetween). */
  weekendNights?: number;
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
    weekendPricePerNightCents = null,
    weekendNights = 0,
    cleaningFeeCents = 0,
    weeklyDiscountPercent,
    monthlyDiscountPercent,
    lastMinuteDiscountPercent,
  } = params;
  const nightlySubtotalCents = nightlySubtotal(nights, pricePerNightCents, weekendNights, weekendPricePerNightCents);
  const chargedWeekendNights =
    weekendPricePerNightCents === null ? 0 : Math.min(Math.max(0, nights), Math.max(0, weekendNights));
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
    weekendNights: chargedWeekendNights,
    weekendNightlyPriceCents: weekendPricePerNightCents,
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
  weekendNights?: number | null;
  weekendNightlyPriceCents?: number | null;
  lengthOfStayDiscountCents: number;
}): number {
  return bookingNightlySubtotalCents(booking) - booking.lengthOfStayDiscountCents;
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

/**
 * The accommodation lines of a price breakdown: one "£X × N nights" line
 * as always, or - for a stay with weekend nights at a weekend rate - one for
 * the weeknights and one for the Friday/Saturday nights, so every breakdown
 * (quote, checkout, receipt, host view) adds up the same way. `format` is
 * the caller's money formatter (some show the guest's display currency).
 */
export function nightlyChargeLines(
  stay: { nights: number; nightlyPriceCents: number; weekendNights?: number | null; weekendNightlyPriceCents?: number | null },
  format: (cents: number) => string,
): { label: string; cents: number }[] {
  const weekend =
    stay.weekendNightlyPriceCents === null || stay.weekendNightlyPriceCents === undefined
      ? 0
      : Math.min(Math.max(0, stay.nights), Math.max(0, stay.weekendNights ?? 0));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (weekend === 0) {
    return [{ label: `${format(stay.nightlyPriceCents)} × ${plural(stay.nights, "night")}`, cents: stay.nights * stay.nightlyPriceCents }];
  }
  const weeknights = stay.nights - weekend;
  const lines: { label: string; cents: number }[] = [];
  if (weeknights > 0) {
    lines.push({ label: `${format(stay.nightlyPriceCents)} × ${plural(weeknights, "weeknight")}`, cents: weeknights * stay.nightlyPriceCents });
  }
  lines.push({
    label: `${format(stay.weekendNightlyPriceCents!)} × ${plural(weekend, "Fri/Sat night")}`,
    cents: weekend * stay.weekendNightlyPriceCents!,
  });
  return lines;
}

/**
 * Why a listing's weekend rate isn't allowed, or null. It can't be below the
 * weekday rate: pricePerNightCents is the "from" price every card, search
 * filter and meta description leads with, and a cheaper weekend would make
 * that headline untrue. A hotel's prices live on its room types instead.
 */
export function weekendRateError(listing: {
  pricePerNightCents: number;
  weekendPricePerNightCents: number | null;
  propertyType?: string | null;
}): string | null {
  if (listing.weekendPricePerNightCents === null) return null;
  if (listing.propertyType === "HOTEL") return "Hotels set their prices on each room type, not a weekend rate";
  if (listing.weekendPricePerNightCents < listing.pricePerNightCents) {
    return "The Friday and Saturday price can't be lower than the weekday price";
  }
  return null;
}
