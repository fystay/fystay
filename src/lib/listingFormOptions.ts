import { computeBookingPricing, stayDiscountName } from "@/lib/pricing";

// Dropdown choices for the host listing form. Ranges match the server's
// zod limits (src/lib/listingInput.ts and PATCH /api/listings/[id]) - a
// dropdown never offers a value the server would refuse, and never hides a
// value the server would accept for a listing that already has one.

export const LISTING_COUNT_RANGES = {
  maxGuests: { min: 1, max: 50 },
  bedrooms: { min: 0, max: 50 },
  beds: { min: 1, max: 50 },
  bathrooms: { min: 0, max: 50 },
} as const;

export const LISTING_NIGHTS_MAX = 365;

// Every night up to two weeks, then the stay lengths hosts actually use.
const NIGHT_STEPS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 28, 30, 45, 60, 90, 120, 180, 270, 365,
];

/** Adds a saved value the standard list doesn't contain, so it's shown and kept rather than silently changed. */
function withCurrent(options: number[], current: string | number | null | undefined): number[] {
  const value = typeof current === "number" ? current : current?.trim() ? Number(current) : NaN;
  if (!Number.isInteger(value) || options.includes(value)) return options;
  return [...options, value].sort((a, b) => a - b);
}

/** Whole numbers from min to max, plus the listing's saved value if it falls outside them. */
export function countOptions(
  range: { min: number; max: number },
  current?: string | number | null,
): number[] {
  const options = Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i);
  return withCurrent(options, current);
}

/** Minimum/maximum stay choices, plus the listing's saved value if it isn't one of them. */
export function nightOptions(current?: string | number | null): number[] {
  return withCurrent(NIGHT_STEPS, current);
}

/** "Maximum stay can't be shorter than the minimum stay", or null - the same rule the server enforces. */
export function stayLengthError(minNights: string, maxNights: string): string | null {
  if (!maxNights.trim()) return null;
  const min = Number(minNights || 1);
  const max = Number(maxNights);
  return max < min ? "Maximum stay can't be shorter than the minimum stay." : null;
}

export type DiscountExample = {
  nights: number;
  weekendNights: number;
  beforeCents: number;
  totalCents: number;
  /** Which discount the booking engine applied, or null for none. */
  appliedName: string | null;
  appliedPercent: number;
};

/**
 * What a guest would pay for an example stay, priced by the booking's own
 * computeBookingPricing - so the preview in the form can't drift from what
 * checkout charges. `lastMinute` asks for the price as if the stay were
 * booked inside the last-minute window.
 */
export function discountExample(params: {
  nights: number;
  pricePerNightCents: number;
  weekendPricePerNightCents: number | null;
  weeklyDiscountPercent: number | null;
  monthlyDiscountPercent: number | null;
  lastMinuteDiscountPercent?: number | null;
}): DiscountExample {
  // Any run of 7 consecutive nights has exactly two Friday/Saturday nights,
  // so a whole number of weeks is exact; shorter examples are weeknights.
  const weekendNights =
    params.weekendPricePerNightCents === null ? 0 : Math.floor(params.nights / 7) * 2;
  const pricing = computeBookingPricing({
    nights: params.nights,
    pricePerNightCents: params.pricePerNightCents,
    weekendPricePerNightCents: params.weekendPricePerNightCents,
    weekendNights,
    weeklyDiscountPercent: params.weeklyDiscountPercent,
    monthlyDiscountPercent: params.monthlyDiscountPercent,
    lastMinuteDiscountPercent: params.lastMinuteDiscountPercent ?? null,
  });
  return {
    nights: params.nights,
    weekendNights: pricing.weekendNights,
    beforeCents: pricing.nightlySubtotalCents,
    totalCents: pricing.totalPriceCents,
    appliedName: pricing.lengthOfStayDiscountLabel ? stayDiscountName(pricing.lengthOfStayDiscountLabel) : null,
    appliedPercent: pricing.lengthOfStayDiscountPercent,
  };
}
