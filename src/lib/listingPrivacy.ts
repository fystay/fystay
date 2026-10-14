/**
 * Listing columns that must never leave the server on a public read (one that
 * needs no login). Arrival details belong to guests with a paid booking, the
 * calendar-feed token works like a password for the host's .ics feed, the
 * street address is shared once a stay is booked, and the rest is internal.
 * Used as a Prisma `omit` so a column added later stays private unless
 * someone deliberately makes it public.
 */
export const PRIVATE_LISTING_FIELDS = {
  address: true,
  checkInInstructions: true,
  wifiNetwork: true,
  wifiPassword: true,
  icalExportToken: true,
  icalImportUrl: true,
  icalSyncedAt: true,
  icalSyncError: true,
  icalSyncFailedAt: true,
  suspendedReason: true,
  // The host's own smart-pricing limits (minimum payout and price bounds).
  smartPricingAutoApply: true,
  smartPricingConsentAt: true,
  smartPricingConsentPolicyVersion: true,
  smartPricingMinPayoutCents: true,
  smartPricingTargetPayoutCents: true,
  smartPricingMinPriceCents: true,
  smartPricingMaxPriceCents: true,
  smartPricingMaxAdjustmentPercent: true,
} as const;

/**
 * A booking as its guest may see it: without the host's private
 * smart-pricing minimum payout it was priced to protect. Used on every
 * guest-facing booking response.
 */
export function guestBookingView<T extends { minHostPayoutPerNightCents?: number | null }>(booking: T): Omit<T, "minHostPayoutPerNightCents"> {
  const view: Partial<T> = { ...booking };
  delete view.minHostPayoutPerNightCents;
  return view as Omit<T, "minHostPayoutPerNightCents">;
}
