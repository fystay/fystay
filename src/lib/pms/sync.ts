import type { PrismaClient, PmsConnection, PmsRoomMapping } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { getPmsAdapter } from "@/lib/pms/registry";
import { decryptPmsCredentials, encryptPmsCredentials } from "@/lib/pms/crypto";
import {
  PmsAdapterError,
  pmsErrorForHost,
  type PmsAdapter,
  type PmsExternalReservation,
} from "@/lib/pms/types";

// ============================================================================
// Known v1 modeling limitation, stated plainly rather than silently
// papered over: FYStay's own pricing/stay-length model is a single flat
// value per Listing/RoomType (pricePerNightCents, minNights/maxNights) -
// there is no per-date rate calendar anywhere in this schema, for a
// FYStay-native listing or a PMS-synced one. A real PMS rate/restriction
// calendar is per-date. Until FYStay grows a real rate-calendar model,
// pullRatesForMapping/pullRestrictionsForMapping pull the PMS's value for
// the *nearest upcoming date* in range and write it into that flat field -
// directionally correct (a host who raises prices in Cloudbeds sees that
// reflected here) but not a faithful per-date sync. Availability, by
// contrast, syncs exactly via reservation import (see
// pullReservationsForMapping) for a single-unit listing; for a HOTEL
// RoomType with totalRooms > 1, one PMS reservation still closes the
// *entire* room type for its date range (see that function's own comment)
// rather than partially reducing the count, which is a deliberate
// fail-safe simplification (never oversells, may under-sell) rather than
// building a parallel partial-inventory model in this same pass.
// ============================================================================

const RECONCILE_WINDOW_DAYS = 365;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Pure diff between AvailabilityBlocks already imported from a PMS mapping
 * and what the PMS reports now - same shape and reasoning as
 * diffIcalImport in icalSync.ts, applied to PMS reservations instead of
 * .ics events. A cancelled PMS reservation is treated as "gone" (deleted),
 * same as an event disappearing from an iCal feed.
 */
export function diffPmsReservations(
  existing: { externalUid: string; startDate: Date; endDate: Date }[],
  fetched: PmsExternalReservation[],
): { toUpsert: PmsExternalReservation[]; toDeleteUids: string[] } {
  const existingByUid = new Map(existing.map((b) => [b.externalUid, b]));
  const confirmed = fetched.filter((r) => r.status === "confirmed");
  const confirmedIds = new Set(confirmed.map((r) => r.externalReservationId));

  const toUpsert = confirmed.filter((reservation) => {
    const current = existingByUid.get(reservation.externalReservationId);
    if (!current) return true;
    return (
      current.startDate.getTime() !== reservation.checkIn.getTime() ||
      current.endDate.getTime() !== reservation.checkOut.getTime()
    );
  });

  const toDeleteUids = existing
    .filter((b) => !confirmedIds.has(b.externalUid))
    .map((b) => b.externalUid);

  return { toUpsert, toDeleteUids };
}

/**
 * Returns this connection's decrypted, guaranteed-fresh credentials -
 * refreshing and re-persisting them first if they're expired or about to
 * expire (a 2-minute buffer, so a token that's valid right now but expires
 * mid-sync doesn't fail partway through a multi-mapping run). Returns null
 * for a connection with no stored credentials at all (never connected, or
 * disconnected) - callers treat that as "nothing to sync", not an error.
 */
export async function getValidCredentials(
  prisma: PrismaClient,
  connection: PmsConnection,
  adapter: PmsAdapter,
): Promise<unknown | null> {
  if (!connection.credentialsCiphertext) return null;
  let credentials = decryptPmsCredentials(connection.credentialsCiphertext);

  const expiringSoon =
    connection.tokenExpiresAt !== null && connection.tokenExpiresAt.getTime() - Date.now() < 2 * 60 * 1000;

  if (adapter.authMethod === "oauth2" && adapter.refreshCredentials && expiringSoon) {
    const refreshed = await adapter.refreshCredentials(credentials);
    credentials = refreshed.credentials;
    await prisma.pmsConnection.update({
      where: { id: connection.id },
      data: {
        credentialsCiphertext: encryptPmsCredentials(credentials),
        tokenExpiresAt: refreshed.expiresAt,
      },
    });
  }

  return credentials;
}

/**
 * Imports a mapped room's PMS reservations as AvailabilityBlocks (source
 * PMS_IMPORT) - exactly diffIcalImport's own approach, applied to a PMS
 * connection instead of an .ics feed. For a HOTEL RoomType mapping with
 * totalRooms > 1, this closes the *whole* room type for a reservation's
 * date range rather than reducing its count by roomsBooked - a fail-safe
 * simplification (this can only ever under-sell a multi-room type, never
 * oversell it) documented at the top of this file, not a bug.
 */
export async function pullReservationsForMapping(
  tx: Prisma.TransactionClient,
  mapping: PmsRoomMapping,
  adapter: PmsAdapter,
  credentials: unknown,
  externalPropertyId: string,
): Promise<{ synced: number; removed: number }> {
  const fetched = await adapter.listReservations(credentials, externalPropertyId, {});
  const forThisRoom = fetched.filter((r) => r.externalRoomId === mapping.externalRoomId);

  const existing = await tx.availabilityBlock.findMany({
    where: { listingId: mapping.listingId, roomTypeId: mapping.roomTypeId, source: "PMS_IMPORT" },
    select: { externalUid: true, startDate: true, endDate: true },
  });
  const existingImported = existing.filter(
    (b): b is { externalUid: string; startDate: Date; endDate: Date } => b.externalUid !== null,
  );

  const plan = diffPmsReservations(existingImported, forThisRoom);

  for (const reservation of plan.toUpsert) {
    await tx.availabilityBlock.upsert({
      where: {
        listingId_externalUid: { listingId: mapping.listingId, externalUid: reservation.externalReservationId },
      },
      create: {
        listingId: mapping.listingId,
        roomTypeId: mapping.roomTypeId,
        externalUid: reservation.externalReservationId,
        startDate: reservation.checkIn,
        endDate: reservation.checkOut,
        source: "PMS_IMPORT",
        reason: reservation.guestName ? `PMS reservation - ${reservation.guestName}` : "PMS reservation",
      },
      update: { startDate: reservation.checkIn, endDate: reservation.checkOut },
    });
  }

  if (plan.toDeleteUids.length > 0) {
    await tx.availabilityBlock.deleteMany({
      where: {
        listingId: mapping.listingId,
        source: "PMS_IMPORT",
        externalUid: { in: plan.toDeleteUids },
      },
    });
  }

  return { synced: plan.toUpsert.length, removed: plan.toDeleteUids.length };
}

/** See the file-level comment: writes the PMS's nearest-date rate into the mapped Listing/RoomType's single flat pricePerNightCents field. */
export async function pullRateForMapping(
  tx: Prisma.TransactionClient,
  mapping: PmsRoomMapping,
  adapter: PmsAdapter,
  credentials: unknown,
  externalPropertyId: string,
): Promise<boolean> {
  const now = new Date();
  const rates = await adapter.getRates(credentials, externalPropertyId, [mapping.externalRoomId], {
    from: now,
    to: addDays(now, RECONCILE_WINDOW_DAYS),
  });
  const nearest = rates.filter((r) => r.date.getTime() >= now.getTime()).sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  if (!nearest) return false;

  if (mapping.roomTypeId) {
    await tx.roomType.update({ where: { id: mapping.roomTypeId }, data: { pricePerNightCents: nearest.priceCents } });
  } else {
    // A property-management system sets day-by-day rates, so a lower synced
    // rate is never presented as a "price drop" (see src/lib/deals.ts): any
    // live drop ends and the price counts as freshly changed.
    await tx.listing.update({
      where: { id: mapping.listingId },
      data: {
        pricePerNightCents: nearest.priceCents,
        priceChangedAt: new Date(),
        priceDropFromCents: null,
        priceDroppedAt: null,
      },
    });
  }
  return true;
}

/** See the file-level comment: writes the PMS's nearest-date min-stay into the mapped Listing/RoomType's minNights field - restrictions live on the parent Listing even for a HOTEL room type mapping, since minNights/maxNights are listing-level in this schema (see prisma/schema.prisma), not per-room-type. */
export async function pullRestrictionsForMapping(
  tx: Prisma.TransactionClient,
  mapping: PmsRoomMapping,
  adapter: PmsAdapter,
  credentials: unknown,
  externalPropertyId: string,
): Promise<boolean> {
  const now = new Date();
  const restrictions = await adapter.getRestrictions(credentials, externalPropertyId, [mapping.externalRoomId], {
    from: now,
    to: addDays(now, RECONCILE_WINDOW_DAYS),
  });
  const nearest = restrictions
    .filter((r) => r.date.getTime() >= now.getTime() && r.minStayNights != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  if (!nearest?.minStayNights) return false;

  await tx.listing.update({ where: { id: mapping.listingId }, data: { minNights: nearest.minStayNights } });
  return true;
}

type ConnectionSyncSummary = { recordCount: number; errors: string[] };

/**
 * Runs a full pull (rates, restrictions, reservations) for every mapped
 * room on one connection, writes a PmsSyncLog row, and updates the
 * connection's own denormalized lastSyncedAt/lastSyncStatus/lastSyncError -
 * the single function both the host's "Sync now" button and the nightly
 * reconciliation cron call. One mapping failing (a room the PMS rejected,
 * a transient error) is caught and recorded, not fatal to every other
 * mapping's sync in the same run - the same resilience pattern as
 * sync-ical-imports' own per-listing try/catch loop.
 */
export async function runConnectionSync(prisma: PrismaClient, connectionId: string): Promise<ConnectionSyncSummary> {
  const startedAt = new Date();
  const connection = await prisma.pmsConnection.findUniqueOrThrow({
    where: { id: connectionId },
    include: { roomMappings: true },
  });
  const adapter = getPmsAdapter(connection.provider);

  const summary: ConnectionSyncSummary = { recordCount: 0, errors: [] };

  if (connection.status !== "CONNECTED" || !connection.externalPropertyId) {
    summary.errors.push("Connection is not active");
    await finishSync(prisma, connection.id, "FULL_RECONCILE", "FAILURE", startedAt, summary);
    return summary;
  }

  let credentials: unknown | null;
  try {
    credentials = await getValidCredentials(prisma, connection, adapter);
  } catch (error) {
    summary.errors.push(errorMessage(error));
    await markConnectionError(prisma, connection.id, errorMessage(error));
    await finishSync(prisma, connection.id, "FULL_RECONCILE", "FAILURE", startedAt, summary);
    return summary;
  }
  if (!credentials) {
    summary.errors.push("No stored credentials");
    await finishSync(prisma, connection.id, "FULL_RECONCILE", "FAILURE", startedAt, summary);
    return summary;
  }

  for (const mapping of connection.roomMappings) {
    try {
      await prisma.$transaction(async (tx) => {
        const ratesUpdated = await pullRateForMapping(tx, mapping, adapter, credentials, connection.externalPropertyId!);
        const restrictionsUpdated = await pullRestrictionsForMapping(
          tx,
          mapping,
          adapter,
          credentials,
          connection.externalPropertyId!,
        );
        const { synced, removed } = await pullReservationsForMapping(
          tx,
          mapping,
          adapter,
          credentials,
          connection.externalPropertyId!,
        );
        summary.recordCount += synced + removed + (ratesUpdated ? 1 : 0) + (restrictionsUpdated ? 1 : 0);
      });
    } catch (error) {
      const message = errorMessage(error);
      summary.errors.push(`Mapping ${mapping.externalRoomId}: ${message}`);
      console.error(`PMS sync failed for mapping ${mapping.id} (connection ${connection.id}):`, error);
    }
  }

  const status = summary.errors.length === 0 ? "SUCCESS" : summary.recordCount > 0 ? "PARTIAL" : "FAILURE";
  await finishSync(prisma, connection.id, "FULL_RECONCILE", status, startedAt, summary);
  return summary;
}

async function finishSync(
  prisma: PrismaClient,
  connectionId: string,
  kind: "FULL_RECONCILE",
  status: "SUCCESS" | "PARTIAL" | "FAILURE",
  startedAt: Date,
  summary: ConnectionSyncSummary,
): Promise<void> {
  const finishedAt = new Date();
  const errorMessageJoined = summary.errors.length > 0 ? summary.errors.join("; ").slice(0, 2000) : null;
  await prisma.$transaction([
    prisma.pmsSyncLog.create({
      data: {
        connectionId,
        kind,
        status,
        recordCount: summary.recordCount,
        errorMessage: errorMessageJoined,
        startedAt,
        finishedAt,
      },
    }),
    prisma.pmsConnection.update({
      where: { id: connectionId },
      data: { lastSyncedAt: finishedAt, lastSyncStatus: status, lastSyncError: errorMessageJoined },
    }),
  ]);
}

async function markConnectionError(prisma: PrismaClient, connectionId: string, message: string): Promise<void> {
  await prisma.pmsConnection.update({ where: { id: connectionId }, data: { status: "ERROR" } });
  void message;
}

/** Stored on sync logs, which hosts see on their Integrations page - so plain words, with the detail logged. */
function errorMessage(error: unknown): string {
  return pmsErrorForHost(error, "Something went wrong with this sync. It will be retried automatically.");
}

const MAX_PUSH_ATTEMPTS = 5;

/**
 * Pushes a real FYStay booking to its listing's connected PMS, if any -
 * a no-op (returns "not_mapped") when the booking's listing/room type has
 * no active PmsRoomMapping. Idempotent via PmsReservationLink: a booking
 * already pushed successfully (externalReservationId set) is never pushed
 * again, so calling this twice for the same booking (a retry, a duplicate
 * webhook-triggered call) can never create two PMS reservations for one
 * FYStay booking. Failures are recorded on the link with an attempt count
 * (see MAX_PUSH_ATTEMPTS) rather than thrown, since the caller (the
 * booking-creation route, the reconciliation cron) must never let a PMS
 * push failure block or roll back the guest's own booking.
 */
export async function pushBookingReservation(
  prisma: PrismaClient,
  bookingId: string,
): Promise<{ status: "pushed" | "already_pushed" | "not_mapped" | "failed" | "gave_up" }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { pmsReservationLink: true },
  });
  if (!booking) return { status: "not_mapped" };
  if (booking.pmsReservationLink?.externalReservationId) return { status: "already_pushed" };
  if (booking.pmsReservationLink && booking.pmsReservationLink.pushAttempts >= MAX_PUSH_ATTEMPTS) {
    return { status: "gave_up" };
  }

  const mapping = await prisma.pmsRoomMapping.findFirst({
    where: booking.roomTypeId ? { roomTypeId: booking.roomTypeId } : { listingId: booking.listingId, roomTypeId: null },
    include: { connection: true },
  });
  if (!mapping || mapping.connection.status !== "CONNECTED" || !mapping.connection.externalPropertyId) {
    return { status: "not_mapped" };
  }

  const adapter = getPmsAdapter(mapping.connection.provider);
  const attempts = (booking.pmsReservationLink?.pushAttempts ?? 0) + 1;

  try {
    const credentials = await getValidCredentials(prisma, mapping.connection, adapter);
    if (!credentials) throw new PmsAdapterError("No stored credentials", { retryable: false });

    const { externalReservationId } = await adapter.createReservation(
      credentials,
      mapping.connection.externalPropertyId,
      {
        externalRoomId: mapping.externalRoomId,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        roomsBooked: booking.roomsBooked,
        guestName: booking.guestName ?? "FYStay guest",
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        totalPriceCents: booking.totalPriceCents,
        currency: "GBP",
        fystayBookingReference: booking.reference,
      },
    );

    await prisma.pmsReservationLink.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        connectionId: mapping.connectionId,
        externalReservationId,
        pushStatus: "SUCCESS",
        pushAttempts: attempts,
        pushedAt: new Date(),
      },
      update: {
        externalReservationId,
        pushStatus: "SUCCESS",
        pushAttempts: attempts,
        pushedAt: new Date(),
        pushError: null,
      },
    });
    return { status: "pushed" };
  } catch (error) {
    const message = errorMessage(error);
    await prisma.pmsReservationLink.upsert({
      where: { bookingId: booking.id },
      create: { bookingId: booking.id, connectionId: mapping.connectionId, pushStatus: "FAILURE", pushError: message, pushAttempts: attempts },
      update: { pushStatus: "FAILURE", pushError: message, pushAttempts: attempts },
    });
    console.error(`PMS reservation push failed for booking ${bookingId}:`, error);
    return { status: attempts >= MAX_PUSH_ATTEMPTS ? "gave_up" : "failed" };
  }
}

/** Same idempotency/retry/never-throw shape as pushBookingReservation, for the cancellation direction - a no-op if the booking was never successfully pushed in the first place (nothing to cancel on the PMS side). */
export async function pushBookingCancellation(
  prisma: PrismaClient,
  bookingId: string,
): Promise<{ status: "cancelled" | "already_cancelled" | "not_mapped" | "failed" | "gave_up" }> {
  const link = await prisma.pmsReservationLink.findUnique({
    where: { bookingId },
    include: { connection: true },
  });
  if (!link?.externalReservationId) return { status: "not_mapped" };
  if (link.cancelPushStatus === "SUCCESS") return { status: "already_cancelled" };
  if (link.cancelPushAttempts >= MAX_PUSH_ATTEMPTS) return { status: "gave_up" };

  const adapter = getPmsAdapter(link.connection.provider);
  const attempts = link.cancelPushAttempts + 1;

  try {
    const credentials = await getValidCredentials(prisma, link.connection, adapter);
    if (!credentials) throw new PmsAdapterError("No stored credentials", { retryable: false });
    if (!link.connection.externalPropertyId) throw new PmsAdapterError("No external property id", { retryable: false });

    await adapter.cancelReservation(credentials, link.connection.externalPropertyId, link.externalReservationId);

    await prisma.pmsReservationLink.update({
      where: { bookingId },
      data: { cancelPushStatus: "SUCCESS", cancelPushAttempts: attempts, cancelPushedAt: new Date(), cancelPushError: null },
    });
    return { status: "cancelled" };
  } catch (error) {
    const message = errorMessage(error);
    await prisma.pmsReservationLink.update({
      where: { bookingId },
      data: { cancelPushStatus: "FAILURE", cancelPushError: message, cancelPushAttempts: attempts },
    });
    console.error(`PMS cancellation push failed for booking ${bookingId}:`, error);
    return { status: attempts >= MAX_PUSH_ATTEMPTS ? "gave_up" : "failed" };
  }
}
