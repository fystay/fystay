import type { ExtraCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendTripExtraProviderEmail } from "@/lib/notificationEmails";

/**
 * Trip Extras Phase 3 (docs/trip-extras-roadmap.md): every provider handoff
 * goes through one adapter contract and one status field
 * (BookingExtra.fulfillmentStatus), so a provider with a real booking API
 * (EV Exec's, if one exists) is a new adapter registered below - not a
 * rewrite of the checkout, webhook or admin screens. The same shape as
 * src/lib/hotelProviders: an interface, a registry, fail closed on an
 * unknown code.
 */

/** Everything a provider needs to take the job - the same facts the Phase 1 email carries. */
export type FulfillmentOrder = {
  bookingExtraId: string;
  offeringName: string;
  category: ExtraCategory;
  priceCents: number;
  guestName: string | null;
  guestEmail: string | null;
  guestNotes: string | null;
  listingTitle: string;
  checkIn: Date;
  checkOut: Date;
  bookingUrl: string;
  provider: {
    name: string;
    notificationEmail: string;
    bookingFormUrl: string | null;
  };
};

/**
 * SENT = the provider has the job but hasn't confirmed it (an email);
 * CONFIRMED = the provider accepted it (an API that confirms synchronously).
 * An adapter reports failure by returning FAILED, never by throwing - a
 * throw is caught and recorded the same way, but shouldn't be relied on.
 */
export type FulfillmentResult =
  | { status: "SENT" | "CONFIRMED"; reference?: string }
  | { status: "FAILED"; error: string };

export interface TripExtraFulfillmentAdapter {
  /** Matches ExtraProvider.integration. */
  readonly code: string;
  fulfill(order: FulfillmentOrder): Promise<FulfillmentResult>;
}

/** Phase 1's behavior as an adapter: email the provider everything their booking form would ask for. */
export const emailFulfillmentAdapter: TripExtraFulfillmentAdapter = {
  code: "email",
  async fulfill(order) {
    const sent = await sendTripExtraProviderEmail({
      guestName: order.guestName,
      guestEmail: order.guestEmail,
      guestNotes: order.guestNotes,
      listingTitle: order.listingTitle,
      checkIn: order.checkIn,
      checkOut: order.checkOut,
      offeringName: order.offeringName,
      priceCents: order.priceCents,
      providerName: order.provider.name,
      providerEmail: order.provider.notificationEmail,
      bookingUrl: order.bookingUrl,
    });
    if (!sent) {
      return {
        status: "FAILED",
        error: process.env.RESEND_API_KEY
          ? "The provider email could not be sent - retry, or contact the provider directly."
          : "Email isn't configured (RESEND_API_KEY) - contact the provider directly, then mark it confirmed.",
      };
    }
    return { status: "SENT" };
  },
};

const ADAPTERS: Record<string, TripExtraFulfillmentAdapter> = {
  [emailFulfillmentAdapter.code]: emailFulfillmentAdapter,
};

export function getFulfillmentAdapter(code: string): TripExtraFulfillmentAdapter | null {
  return Object.hasOwn(ADAPTERS, code) ? ADAPTERS[code] : null;
}

export function registeredFulfillmentIntegrations(): string[] {
  return Object.keys(ADAPTERS);
}

/**
 * A SENDING row older than this is treated as an attempt that died
 * mid-handoff (a crashed function, a timeout) and can be claimed again.
 * Long enough that a slow provider API call still in flight isn't raced.
 */
export const STALE_SENDING_MS = 10 * 60 * 1000;

/** A SENDING handoff old enough that an admin retry (fulfillBookingExtra with retry) can claim it again. */
export function isFulfillmentStuck(
  extra: { fulfillmentStatus: string; updatedAt: Date },
  now: Date = new Date(),
): boolean {
  return extra.fulfillmentStatus === "SENDING" && extra.updatedAt.getTime() < now.getTime() - STALE_SENDING_MS;
}

export type FulfillOutcome =
  | { kind: "done"; status: "SENT" | "CONFIRMED" | "FAILED" }
  | { kind: "skipped"; reason: "not_paid" | "not_claimable" };

/**
 * Hands one paid BookingExtra to its provider, at most once at a time.
 *
 * The claim is a conditional update to SENDING, so callers racing each
 * other can't all send - only the one whose update matched a row goes on
 * to call the adapter. The automatic path (payment confirmed) claims only
 * PENDING, so it hands a job over at most once; a FAILED or stuck (stale
 * SENDING) handoff is re-attempted only by an explicit admin retry
 * (`{ retry: true }`). Never throws on a provider failure: the
 * payment already succeeded, so a failed handoff is recorded as FAILED for
 * an admin to retry, not surfaced as an error to the caller.
 */
export async function fulfillBookingExtra(
  bookingExtraId: string,
  { retry = false, now = new Date() }: { retry?: boolean; now?: Date } = {},
): Promise<FulfillOutcome> {
  const extra = await prisma.bookingExtra.findUniqueOrThrow({
    where: { id: bookingExtraId },
    include: {
      offering: { include: { provider: true } },
      booking: { include: { listing: { select: { title: true } } } },
    },
  });
  if (extra.status !== "PAID") return { kind: "skipped", reason: "not_paid" };

  const claimed = await prisma.bookingExtra.updateMany({
    where: {
      id: bookingExtraId,
      status: "PAID",
      OR: retry
        ? [
            { fulfillmentStatus: { in: ["PENDING", "FAILED"] } },
            { fulfillmentStatus: "SENDING", updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
          ]
        : [{ fulfillmentStatus: "PENDING" }],
    },
    data: { fulfillmentStatus: "SENDING", fulfillmentAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) return { kind: "skipped", reason: "not_claimable" };

  const provider = extra.offering.provider;
  const adapter = getFulfillmentAdapter(provider.integration);
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  let result: FulfillmentResult;
  if (!adapter) {
    result = {
      status: "FAILED",
      error: `No fulfillment adapter is registered for "${provider.integration}" - fix the provider's integration, then retry.`,
    };
  } else {
    try {
      result = await adapter.fulfill({
        bookingExtraId: extra.id,
        offeringName: extra.offering.name,
        category: extra.offering.category,
        priceCents: extra.priceCents,
        guestName: extra.booking.guestName,
        guestEmail: extra.booking.guestEmail,
        guestNotes: extra.guestNotes,
        listingTitle: extra.booking.listing.title,
        checkIn: extra.booking.checkIn,
        checkOut: extra.booking.checkOut,
        bookingUrl: `${baseUrl}/bookings/${extra.bookingId}`,
        provider: {
          name: provider.name,
          notificationEmail: provider.notificationEmail,
          bookingFormUrl: provider.bookingFormUrl,
        },
      });
    } catch (error) {
      console.error("Trip extra fulfillment adapter threw", { bookingExtraId, integration: adapter.code, error });
      result = { status: "FAILED", error: "The provider handoff failed unexpectedly - retry, or contact the provider directly." };
    }
  }

  const finishedAt = new Date();
  if (result.status === "FAILED") {
    await prisma.bookingExtra.update({
      where: { id: bookingExtraId },
      data: { fulfillmentStatus: "FAILED", fulfillmentError: result.error.slice(0, 500) },
    });
  } else {
    await prisma.bookingExtra.update({
      where: { id: bookingExtraId },
      data: {
        fulfillmentStatus: result.status,
        fulfillmentError: null,
        ...(result.reference ? { fulfillmentReference: result.reference.slice(0, 200) } : {}),
        ...(result.status === "CONFIRMED" ? { fulfillmentConfirmedAt: finishedAt } : {}),
        // Kept for everything that already reads it (Phase 1's own field).
        sentToProviderAt: extra.sentToProviderAt ?? finishedAt,
      },
    });
  }
  return { kind: "done", status: result.status };
}

/**
 * An admin recording that the provider confirmed the job (by email or
 * phone, for an adapter that can't confirm on its own). Only from SENT or
 * FAILED - a FAILED handoff the admin sorted out by hand is still a real
 * confirmation. Conditional, so it can't overwrite a handoff in flight.
 */
export async function confirmBookingExtraFulfillment(
  bookingExtraId: string,
  reference: string | null,
): Promise<boolean> {
  const updated = await prisma.bookingExtra.updateMany({
    where: { id: bookingExtraId, status: "PAID", fulfillmentStatus: { in: ["SENT", "FAILED"] } },
    data: {
      fulfillmentStatus: "CONFIRMED",
      fulfillmentConfirmedAt: new Date(),
      fulfillmentError: null,
      ...(reference ? { fulfillmentReference: reference } : {}),
    },
  });
  return updated.count === 1;
}
