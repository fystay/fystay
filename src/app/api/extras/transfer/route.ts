import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { allowsUnpaidConfirmation, getStripeClient } from "@/lib/stripe";
import { decideExistingSessionAction } from "@/lib/checkoutSession";
import { withApiErrorHandling } from "@/lib/apiError";
import { BASE_URL } from "@/lib/baseUrl";
import { getOrCreateStripeCustomer } from "@/lib/stripeCustomer";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { composeJourneyNotes, transferJourneySchema, transferTimeError } from "@/lib/transferJourney";
import { notifyTripExtraPaid } from "@/app/api/bookings/[id]/extras/route";

/**
 * Buys an airport transfer on its own, with no stay (the same product as
 * the add-on to a booking - see POST /api/bookings/[id]/extras - charged to
 * FYStay's own Stripe account). The signed-in guest gives the journey; one
 * BookingExtra row (guestId set, bookingId null) holds it, and the Stripe
 * webhook is what marks it paid and hands it to the provider.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Please sign in to book a transfer." }, { status: 401 });
  }

  const rateLimit = await checkRateLimit({
    key: `transfer-checkout:${session.user.id}`,
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const parsed = transferJourneySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const journey = parsed.data;

  const pickupAt = new Date(journey.pickupAt);
  const timeError = transferTimeError(pickupAt);
  if (timeError) return NextResponse.json({ error: timeError }, { status: 400 });

  const offering = await prisma.extraOffering.findUnique({
    where: { id: journey.offeringId },
    include: { provider: true },
  });
  if (!offering || offering.category !== "AIRPORT_TRANSFER" || !offering.active || !offering.provider.active) {
    return NextResponse.json({ error: "This transfer isn't available right now." }, { status: 409 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    return NextResponse.json({ error: "Please sign in to book a transfer." }, { status: 401 });
  }

  const stripe = getStripeClient();
  // Same rule as every other checkout: no Stripe key on a production
  // deployment means payments aren't available, never that it's free.
  if (!stripe && !allowsUnpaidConfirmation()) {
    return NextResponse.json(
      { error: "Online payment isn't available yet, so this transfer can't be booked. Please try again later." },
      { status: 503 },
    );
  }

  const details = {
    priceCents: offering.priceCents,
    guestNotes: composeJourneyNotes(journey),
    contactName: journey.contactName,
    contactEmail: user.email,
    contactPhone: journey.contactPhone,
    travelAt: pickupAt,
  };

  // A guest re-submitting (double-click, a second tab, fixing a detail and
  // trying again) reuses their still-unpaid attempt for this transfer
  // rather than piling up a second chargeable one.
  const pending = await prisma.bookingExtra.findFirst({
    where: { guestId: session.user.id, offeringId: offering.id, status: "PENDING_PAYMENT" },
    orderBy: { createdAt: "desc" },
  });
  const row = pending
    ? await prisma.bookingExtra.update({ where: { id: pending.id }, data: details })
    : await prisma.bookingExtra.create({ data: { ...details, guestId: session.user.id, offeringId: offering.id } });

  if (!stripe) {
    // Non-production without Stripe keys: confirm directly, like the add-on's own dev fallback.
    await prisma.bookingExtra.update({ where: { id: row.id }, data: { status: "PAID", paidAt: new Date() } });
    await notifyTripExtraPaid(row.id);
    return NextResponse.json({ devMode: true, paid: true });
  }

  if (pending?.stripeSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(pending.stripeSessionId);
    const action = decideExistingSessionAction(existing.status);
    if (action === "already_paid") {
      return NextResponse.json({ error: "This transfer has already been paid for - check My trips." }, { status: 409 });
    }
    // An open session was priced when it was made; only reuse it if the price still matches.
    if (action === "reuse" && existing.url && existing.amount_total === offering.priceCents) {
      return NextResponse.json({ url: existing.url });
    }
  }

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
    metadata: { purpose: "trip_extra", bookingExtraId: row.id },
    // Just over Stripe's 30-minute minimum, like the booking checkout.
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: `${BASE_URL}/bookings?transfer_success=1`,
    cancel_url: `${BASE_URL}/travel-extras?category=AIRPORT_TRANSFER&cancelled=1`,
  });

  await prisma.bookingExtra.update({ where: { id: row.id }, data: { stripeSessionId: checkoutSession.id } });
  return NextResponse.json({ url: checkoutSession.url });
}

export const POST = withApiErrorHandling(postHandler);
