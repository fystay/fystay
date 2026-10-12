import type { PrismaClient } from "@prisma/client";
import { isIcsCalendar, parseIcsEvents } from "@/lib/icalParse";
import { safeFetchText, UnsafeUrlError } from "@/lib/safeFetch";
import { BASE_URL } from "@/lib/baseUrl";
import { reportError } from "@/lib/observability";

export type ExistingImportedBlock = { externalUid: string; startDate: Date; endDate: Date };
export type FetchedIcsEvent = { uid: string; start: Date; end: Date };

export type IcalSyncPlan = {
  /** New or changed-date events to upsert as an AvailabilityBlock. */
  toUpsert: FetchedIcsEvent[];
  /** externalUids of previously-imported blocks whose event no longer exists in the feed - the external booking was cancelled or removed. */
  toDeleteUids: string[];
};

/**
 * Pure diff between what's already stored (from the last sync) and what
 * the external feed says now, so the caller can turn this into exactly the
 * writes needed - no full delete-and-recreate, which would needlessly
 * touch every AvailabilityBlock row on every sync and briefly leave a
 * currently-blocked date looking available mid-sync. An event whose dates
 * are unchanged since last sync is left alone entirely (neither upserted
 * nor deleted).
 */
export function diffIcalImport(
  existing: ExistingImportedBlock[],
  fetched: FetchedIcsEvent[],
): IcalSyncPlan {
  const existingByUid = new Map(existing.map((b) => [b.externalUid, b]));
  const fetchedUids = new Set(fetched.map((e) => e.uid));

  const toUpsert = fetched.filter((event) => {
    const current = existingByUid.get(event.uid);
    if (!current) return true;
    return (
      current.startDate.getTime() !== event.start.getTime() ||
      current.endDate.getTime() !== event.end.getTime()
    );
  });

  const toDeleteUids = existing.filter((b) => !fetchedUids.has(b.externalUid)).map((b) => b.externalUid);

  return { toUpsert, toDeleteUids };
}

/**
 * Is this one of FYStay's own calendar export links? Importing it would
 * feed FYStay's bookings back in as "booked elsewhere".
 */
export function isFystayCalendarExport(raw: string, baseUrl: string = BASE_URL): boolean {
  try {
    const url = new URL(raw);
    const ownHosts = new Set([new URL(baseUrl).hostname.replace(/^www\./, ""), "fystay.co.uk", "fystay.vercel.app"]);
    return ownHosts.has(url.hostname.replace(/^www\./, "")) && /\/calendar\.ics$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** A sync that failed, with a reason the host can act on. */
export class IcalSyncError extends Error {}

/** Fetches and reads the feed, or throws IcalSyncError saying what went wrong. */
async function fetchImportedEvents(url: string, timeoutMs?: number) {
  let response;
  try {
    // The URL is whatever the host typed, so it's fetched through
    // safeFetchText (public addresses only, time and size limits), never a
    // bare fetch().
    response = await safeFetchText(url, { accept: "text/calendar, text/plain, */*", timeoutMs });
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw new IcalSyncError(`That calendar link can't be used: ${error.message}.`);
    throw new IcalSyncError("The other calendar didn't respond. FYStay will try again at the next sync.");
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new IcalSyncError(
      `The other site refused the calendar link (${response.status}). Check it's the current export link - Airbnb issues a new one if you reset it.`,
    );
  }
  if (!response.ok) throw new IcalSyncError(`The other calendar returned an error (${response.status}). FYStay will try again at the next sync.`);
  // An error or sign-in page that answered "200 OK" mustn't read as an
  // empty calendar - that would clear every imported date.
  if (!isIcsCalendar(response.text)) {
    throw new IcalSyncError("That link didn't return a calendar file. Use the calendar's export (iCal / .ics) link.");
  }
  return parseIcsEvents(response.text);
}

/** Records a failed sync for the host to see; the imported dates from the last good sync stay in place. */
async function recordSyncFailure(prisma: PrismaClient, listingId: string, error: unknown) {
  const message = error instanceof IcalSyncError ? error.message : "The calendar couldn't be synced. FYStay will try again at the next sync.";
  await prisma.listing.update({
    where: { id: listingId },
    data: { icalSyncError: message.slice(0, 500), icalSyncFailedAt: new Date() },
  });
}

/**
 * Fetches a listing's external .ics import URL, diffs it against the
 * AvailabilityBlocks already synced from it, and applies exactly the
 * change set. Only ICAL_IMPORT blocks are ever written or removed: bookings
 * and HOST-set blocks are never touched, so a refresh can't cancel a stay.
 * Returns null (and touches nothing) if the listing has no import URL;
 * on failure records the reason on the listing (shown to the host), keeps
 * the last good sync's dates, and throws IcalSyncError.
 */
export async function syncListingIcalImport(
  prisma: PrismaClient,
  listingId: string,
  { timeoutMs }: { timeoutMs?: number } = {},
): Promise<{ synced: number; removed: number } | null> {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true, icalImportUrl: true } });
  if (!listing?.icalImportUrl) return null;

  let fetched;
  try {
    fetched = await fetchImportedEvents(listing.icalImportUrl, timeoutMs);
  } catch (error) {
    await recordSyncFailure(prisma, listingId, error);
    throw error;
  }

  const existing = await prisma.availabilityBlock.findMany({
    where: { listingId, source: "ICAL_IMPORT" },
    select: { externalUid: true, startDate: true, endDate: true },
  });
  // externalUid is only ever null on HOST blocks, which this query already
  // excludes via source: "ICAL_IMPORT" - narrowed here purely for the pure
  // diffIcalImport's stricter (non-nullable) type.
  const existingImported = existing.filter(
    (b): b is ExistingImportedBlock => b.externalUid !== null,
  );

  const plan = diffIcalImport(existingImported, fetched);

  for (const event of plan.toUpsert) {
    await prisma.availabilityBlock.upsert({
      where: { listingId_externalUid: { listingId, externalUid: event.uid } },
      create: {
        listingId,
        externalUid: event.uid,
        startDate: event.start,
        endDate: event.end,
        source: "ICAL_IMPORT",
        reason: "Imported from external calendar",
      },
      update: { startDate: event.start, endDate: event.end },
    });
  }

  if (plan.toDeleteUids.length > 0) {
    await prisma.availabilityBlock.deleteMany({
      where: { listingId, source: "ICAL_IMPORT", externalUid: { in: plan.toDeleteUids } },
    });
  }

  await prisma.listing.update({
    where: { id: listingId },
    data: { icalSyncedAt: new Date(), icalSyncError: null, icalSyncFailedAt: null },
  });

  return { synced: plan.toUpsert.length, removed: plan.toDeleteUids.length };
}

/** How old an imported calendar may be before a new booking re-syncs it first. */
export const ICAL_IMPORT_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Called just before a booking takes dates: re-syncs the listing's imported
 * calendar if it's older than ICAL_IMPORT_MAX_AGE_MS, so dates booked on
 * Airbnb or another site since the daily sweep (vercel.json) aren't sold
 * twice. Short timeout and never throws - if the other site is slow or
 * down, the booking goes ahead on the last synced calendar, as it did
 * before, and the failure is reported.
 */
export async function refreshStaleIcalImport(
  prisma: PrismaClient,
  listingId: string,
  { now = new Date(), sync = syncListingIcalImport }: { now?: Date; sync?: typeof syncListingIcalImport } = {},
): Promise<void> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { icalImportUrl: true, icalSyncedAt: true, icalSyncFailedAt: true },
  });
  if (!listing?.icalImportUrl) return;
  if (listing.icalSyncedAt && now.getTime() - listing.icalSyncedAt.getTime() < ICAL_IMPORT_MAX_AGE_MS) return;
  // Don't keep every guest waiting on a link that just failed; the host
  // has been shown the error and the daily sync retries.
  if (listing.icalSyncFailedAt && now.getTime() - listing.icalSyncFailedAt.getTime() < ICAL_IMPORT_MAX_AGE_MS) return;
  try {
    await sync(prisma, listingId, { timeoutMs: 4000 });
  } catch (error) {
    reportError(error, { area: "sync", message: `iCal refresh before booking failed for listing ${listingId}` });
  }
}
