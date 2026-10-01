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
  suspendedReason: true,
} as const;
