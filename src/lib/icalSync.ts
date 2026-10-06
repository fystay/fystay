import type { PrismaClient } from "@prisma/client";
import { parseIcsEvents } from "@/lib/icalParse";
import { safeFetchText } from "@/lib/safeFetch";

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
 * Fetches a listing's external .ics import URL, diffs it against the
 * AvailabilityBlocks already synced from it, and applies exactly the
 * change set - never touching HOST-sourced blocks. Returns null (and
 * touches nothing) if the listing has no import URL configured; throws if
 * the fetch itself fails, so the caller (the on-demand API route, or the
 * nightly cron sweep) can surface or log that distinctly from "nothing to
 * sync".
 */
export async function syncListingIcalImport(
  prisma: PrismaClient,
  listingId: string,
): Promise<{ synced: number; removed: number } | null> {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true, icalImportUrl: true } });
  if (!listing?.icalImportUrl) return null;

  // The URL is whatever the host typed, so it's fetched through safeFetchText
  // (public addresses only, time and size limits), never a bare fetch().
  const response = await safeFetchText(listing.icalImportUrl, {
    accept: "text/calendar, text/plain, */*",
  });
  if (!response.ok) {
    throw new Error(`Import feed returned ${response.status}`);
  }
  const fetched = parseIcsEvents(response.text);

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

  await prisma.listing.update({ where: { id: listingId }, data: { icalSyncedAt: new Date() } });

  return { synced: plan.toUpsert.length, removed: plan.toDeleteUids.length };
}
