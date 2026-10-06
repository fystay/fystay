import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { allowsUnpaidConfirmation, getStripeClient } from "@/lib/stripe";
import { decideExistingSessionAction } from "@/lib/checkoutSession";
import { tripExtraPurchaseError } from "@/lib/tripExtras";
import { sendTripExtraGuestConfirmationEmail } from "@/lib/notificationEmails";
import { fulfillBookingExtra } from "@/lib/tripExtraFulfillment";
import { withApiErrorHandling } from "@/lib/apiError";
import { BASE_URL } from "@/lib/baseUrl";
import { getOrCreateStripeCustomer } from "@/lib/stripeCustomer";

/**
 * Lists what's available to add to this booking (see
 * docs/trip-extras-roadmap.md) alongside anything already purchased, so the
 * "Complete your trip" UI has everything it needs in one call.
 */
async function getHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const booking = await prisma.booking.findUnique({ where: { id }, select: { guestId: true } });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [offerings, purchased] = await Promise.all([
    prisma.extraOffering.findMany({
      where: { active: true, provider: { active: true } },
      include: { provider: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.bookingExtra.findMany({
      where: { bookingId: id },
      include: { offering: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({
    offerings: offerings.map((offering) => ({
      id: offering.id,
      name: offering.name,
      description: offering.description,
      category: offering.category,
      priceCents: offering.priceCents,
      providerName: offering.provider.name,
    })),
    purchased: purchased.map((extra) => ({
      id: extra.id,
      offeringId: extra.offeringId,
      offeringName: extra.offering.name,
      priceCents: extra.priceCents,
      status: extra.status,
    })),
  });
}

const purchaseSchema = z.object({
  offeringId: z.string().min(1),
  guestNotes: z.string().trim().max(2000, "That's a bit long - keep it under 2000 characters.").optional(),
});

/**
 * Buys one Trip Extra against this booking: creates the BookingExtra row
 * and a Stripe Checkout session charged to FYStay's own platform account
 * (never Connect - see the roadmap's "Payments" section, this is FYStay's
 * own product, not the host's nightly rate). The webhook is what actually
 * marks it paid and fires the provider/guest emails, the same separation
 * the main booking checkout already uses.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = purchaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { listing: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const offering = await prisma.extraOffering.findUnique({
    where: { id: parsed.data.offeringId },
    include: { provider: true },
  });
  if (!offering) {
    return NextResponse.json({ error: "This extra doesn't exist" }, { status: 404 });
  }

  const stripe = getStripeClient();
  // Same rule as the main checkout: a missing STRIPE_SECRET_KEY on a
  // production deployment means payments aren't available, never that the
  // extra is free. Refused before anything is claimed, so nothing is marked
  // paid and the provider is never told about an unpaid order.
  if (!stripe && !allowsUnpaidConfirmation()) {
    return NextResponse.json(
      { error: "Online payment isn't available yet, so this extra can't be booked. Please try again later." },
      { status: 503 },
    );
  }
  const guestNotes = parsed.data.guestNotes ?? null;

  // The eligibility check (has this already been paid for?) and claiming a
  // row for this purchase attempt happen inside one SERIALIZABLE
  // transaction, retried on conflict - otherwise two concurrent requests
  // for the same (booking, offering) could each read "not already paid"
  // and each create their own BookingExtra + Stripe charge. Postgres's own
  // conflict detection on the shared read aborts the loser with a P2034,
  // caught below, and its retry then sees the winner's row and reuses it
  // instead - the same SSI-based guarantee src/app/api/bookings/route.ts
  // relies on for room-type inventory.
  let claim: ClaimedBookingExtra;
  try {
    claim = await runClaimWithRetry({ booking, offering, guestNotes, devMode: !stripe });
  } catch (error) {
    if (error instanceof TripExtraPurchaseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  if (claim.kind === "dev_paid") {
    // Stripe isn't configured on a non-production deployment (local dev,
    // CI, preview - production is refused above) - the claim step already
    // confirmed this row directly, the same fallback the main booking
    // checkout uses, so this feature stays exercisable without real keys.
    await notifyTripExtraPaid(claim.extraId);
    return NextResponse.json({ devMode: true, paid: true });
  }

  // A guest re-submitting (double-click, a second tab) for the exact same
  // still-unpaid extra reuses that attempt rather than piling up a second
  // chargeable session - the same reasoning as the main booking checkout's
  // own stripeSessionId reuse.
  if (claim.existingStripeSessionId && stripe) {
    const existingSession = await stripe.checkout.sessions.retrieve(claim.existingStripeSessionId);
    const action = decideExistingSessionAction(existingSession.status);
    if (action === "reuse" && existingSession.url) {
      return NextResponse.json({ url: existingSession.url });
    }
    if (action === "already_paid") {
      return NextResponse.json(
        { error: "This extra has already been paid for - refresh the page" },
        { status: 409 },
      );
    }
    // "create_new": that attempt's session expired unpaid - fall through
    // and start a fresh one below, reusing the same row rather than
    // leaving an orphaned PENDING_PAYMENT one behind.
  }

  if (!stripe) {
    // The claim step only takes this branch when devMode was true above,
    // so a real Stripe client missing here would mean it flipped out from
    // under us mid-request - not something to silently paper over.
    return NextResponse.json({ error: "Payments are not configured" }, { status: 500 });
  }

  const baseUrl = BASE_URL;
  const bookingUrl = `${baseUrl}/bookings/${booking.id}`;

  // claim.extraId is already known at this point (the row was claimed
  // before this Stripe call), so the session's metadata can carry it from
  // the start - no separate metadata-update round trip needed.
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer: await getOrCreateStripeCustomer(stripe, prisma, session.user.id),
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: { name: `${offering.name} (${offering.provider.name})` },
          unit_amount: offering.priceCents,
        },
        quantity: 1,
      },
    ],
    metadata: { purpose: "trip_extra", bookingExtraId: claim.extraId },
    success_url: `${bookingUrl}?extra_success=1`,
    cancel_url: `${bookingUrl}?extra_cancelled=1`,
  });

  await prisma.bookingExtra.update({
    where: { id: claim.extraId },
    data: { stripeSessionId: checkoutSession.id },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

class TripExtraPurchaseError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type ClaimedBookingExtra =
  | { kind: "dev_paid"; extraId: string }
  | { kind: "needs_stripe_session"; extraId: string; existingStripeSessionId: string | null };

/**
 * Runs claimBookingExtraSlot in a SERIALIZABLE transaction, retrying on a
 * genuine conflict with a concurrent purchase attempt - the same
 * retry-on-P2034 shape as src/app/api/bookings/route.ts's own booking
 * creation loop.
 */
async function runClaimWithRetry(params: {
  booking: { id: string; status: string };
  offering: { id: string; priceCents: number; active: boolean; provider: { active: boolean } };
  guestNotes: string | null;
  devMode: boolean;
}): Promise<ClaimedBookingExtra> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        (tx) => claimBookingExtraSlot(tx, params),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof TripExtraPurchaseError) throw error;
      const isRetryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!isRetryable || attempt === 2) throw error;
    }
  }
  throw new TripExtraPurchaseError(409, "Please try again");
}

/**
 * Reads this booking's existing extras and either hands back the row
 * already claimed for this offering (a still-unpaid earlier attempt) or
 * creates a fresh one - all inside the SERIALIZABLE transaction
 * runClaimWithRetry wraps this in, so the read and the create/update
 * happen against one consistent snapshot. In dev mode (no Stripe
 * configured) the row is confirmed PAID right here, since there's no
 * external checkout step to wait for.
 */
async function claimBookingExtraSlot(
  tx: Prisma.TransactionClient,
  params: {
    booking: { id: string; status: string };
    offering: { id: string; priceCents: number; active: boolean; provider: { active: boolean } };
    guestNotes: string | null;
    devMode: boolean;
  },
): Promise<ClaimedBookingExtra> {
  const { booking, offering, guestNotes, devMode } = params;

  const existingExtras = await tx.bookingExtra.findMany({
    where: { bookingId: booking.id },
    select: { id: true, offeringId: true, status: true, stripeSessionId: true },
  });

  const eligibilityError = tripExtraPurchaseError(
    booking,
    { active: offering.active, providerActive: offering.provider.active },
    offering.id,
    existingExtras,
  );
  if (eligibilityError) {
    throw new TripExtraPurchaseError(409, eligibilityError);
  }

  const pendingForThisOffering = existingExtras.find(
    (extra) => extra.offeringId === offering.id && extra.status === "PENDING_PAYMENT",
  );

  if (devMode) {
    const paid = pendingForThisOffering
      ? await tx.bookingExtra.update({
          where: { id: pendingForThisOffering.id },
          data: { status: "PAID", paidAt: new Date(), guestNotes },
        })
      : await tx.bookingExtra.create({
          data: {
            bookingId: booking.id,
            offeringId: offering.id,
            priceCents: offering.priceCents,
            guestNotes,
            status: "PAID",
            paidAt: new Date(),
          },
        });
    return { kind: "dev_paid", extraId: paid.id };
  }

  if (pendingForThisOffering) {
    if (guestNotes !== null) {
      await tx.bookingExtra.update({ where: { id: pendingForThisOffering.id }, data: { guestNotes } });
    }
    return {
      kind: "needs_stripe_session",
      extraId: pendingForThisOffering.id,
      existingStripeSessionId: pendingForThisOffering.stripeSessionId,
    };
  }

  const created = await tx.bookingExtra.create({
    data: {
      bookingId: booking.id,
      offeringId: offering.id,
      priceCents: offering.priceCents,
      guestNotes,
    },
  });
  return { kind: "needs_stripe_session", extraId: created.id, existingStripeSessionId: null };
}

/**
 * Shared by both the dev-mode (no Stripe keys) fallback above and the real
 * Stripe webhook: hands the job to the provider (through its fulfillment
 * adapter, which records the outcome on fulfillmentStatus) and sends the
 * guest their receipt. Exported so the webhook route can call the exact same logic
 * rather than duplicating it.
 */
export async function notifyTripExtraPaid(bookingExtraId: string): Promise<void> {
  const bookingExtra = await prisma.bookingExtra.findUniqueOrThrow({
    where: { id: bookingExtraId },
    include: {
      offering: { include: { provider: true } },
      booking: { include: { listing: true } },
    },
  });

  const baseUrl = BASE_URL;
  const ctx = {
    guestName: bookingExtra.booking.guestName,
    guestEmail: bookingExtra.booking.guestEmail,
    guestNotes: bookingExtra.guestNotes,
    listingTitle: bookingExtra.booking.listing.title,
    checkIn: bookingExtra.booking.checkIn,
    checkOut: bookingExtra.booking.checkOut,
    offeringName: bookingExtra.offering.name,
    priceCents: bookingExtra.priceCents,
    providerName: bookingExtra.offering.provider.name,
    providerEmail: bookingExtra.offering.provider.notificationEmail,
    bookingUrl: `${baseUrl}/bookings/${bookingExtra.bookingId}`,
  };

  // The provider handoff goes through the fulfillment adapter for this
  // provider (src/lib/tripExtraFulfillment.ts), which records its outcome
  // on fulfillmentStatus and claims the row first, so a retried webhook
  // can't hand the same job over twice.
  await fulfillBookingExtra(bookingExtraId);
  await sendTripExtraGuestConfirmationEmail(ctx);

  // The one point both the dev-mode fallback and the real Stripe webhook
  // funnel through on a successful purchase (see this function's own doc
  // comment above) - the right place to record the "added"/"completed"
  // cross-sell events (item 10 of the cross-sell brief), since a client-
  // side trackAddonEvent call would never fire for the Stripe redirect
  // path (the browser navigates away before payment succeeds). Scoped to
  // AIRPORT_TRANSFER since those are the specific event names the brief
  // asks for; a future add-on category would get its own analogous names.
  if (bookingExtra.offering.category === "AIRPORT_TRANSFER") {
    await prisma.analyticsEvent.createMany({
      data: [
        {
          name: "transfer_added",
          category: bookingExtra.offering.category,
          surface: "server",
          bookingId: bookingExtra.bookingId,
          offeringId: bookingExtra.offeringId,
        },
        {
          name: "transfer_booking_completed",
          category: bookingExtra.offering.category,
          surface: "server",
          bookingId: bookingExtra.bookingId,
          offeringId: bookingExtra.offeringId,
        },
      ],
    });
  }
}

export const GET = withApiErrorHandling(getHandler);
export const POST = withApiErrorHandling(postHandler);
