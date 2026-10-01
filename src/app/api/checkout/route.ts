import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiErrorHandling } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { allowsUnpaidConfirmation, getStripeClient, PAYMENTS_UNAVAILABLE_MESSAGE } from "@/lib/stripe";
import { decideExistingSessionAction } from "@/lib/checkoutSession";
import { HOST_NOT_PAYMENT_READY_MESSAGE, verifyHostPaymentReady } from "@/lib/stripeConnect";
import { applyDiscountsToApplicationFee, discountedAccommodationCents } from "@/lib/pricing";
import { sendBookingConfirmedEmails } from "@/lib/notificationEmails";
import { awardReferralBonusIfEligible } from "@/lib/referral";
import { isBookingHoldActive, isRequestedRangeStillAvailable } from "@/lib/availability";

/**
 * Just over Stripe's 30-minute minimum Checkout Session lifetime - the
 * extra minute keeps clock skew between us and Stripe from tipping a request
 * under the minimum.
 */
const CHECKOUT_SESSION_TTL_SECONDS = 31 * 60;

const checkoutSchema = z.object({
  bookingId: z.string().min(1),
  guestName: z.string().trim().min(1, "Please enter your name.").max(200, "Name is too long.").optional(),
  guestEmail: z
    .string()
    .trim()
    .email("Please enter a valid email address.")
    .max(200, "Email is too long.")
    .optional(),
  guestPhone: z
    .string()
    .trim()
    .min(1, "Please enter a phone number.")
    .max(50, "Phone number is too long.")
    .optional(),
});

async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  let booking = await prisma.booking.findUnique({
    where: { id: parsed.data.bookingId },
    include: { listing: { include: { host: true } }, roomType: { select: { name: true } } },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.status !== "PENDING") {
    return NextResponse.json(
      { error: "This booking has already been processed" },
      { status: 409 },
    );
  }
  if (booking.approvalStatus === "AWAITING") {
    return NextResponse.json(
      { error: "This booking is still awaiting host approval" },
      { status: 403 },
    );
  }

  // The booking only holds its dates for a short window (see
  // blockingBookingWhere). A guest returning after it lapsed may only pay if
  // nobody else has taken the dates since; otherwise the booking is released
  // so they can pick new dates instead of paying for a stay that's gone.
  if (
    !isBookingHoldActive(booking) &&
    !(await isRequestedRangeStillAvailable(prisma, {
      listingId: booking.listingId,
      roomTypeId: booking.roomTypeId,
      roomsBooked: booking.roomsBooked,
      excludeBookingId: booking.id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
    }))
  ) {
    await prisma.booking.updateMany({
      where: { id: booking.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    return NextResponse.json(
      { error: "Sorry, these dates were booked by someone else while your hold expired. Please choose new dates." },
      { status: 409 },
    );
  }

  // Guest details entered/confirmed on the checkout page are saved onto the
  // booking right before payment, so they're captured even if the guest
  // never returns from Stripe (e.g. closes the tab mid-payment).
  if (parsed.data.guestName || parsed.data.guestEmail || parsed.data.guestPhone) {
    booking = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        guestName: parsed.data.guestName ?? booking.guestName,
        guestEmail: parsed.data.guestEmail ?? booking.guestEmail,
        guestPhone: parsed.data.guestPhone ?? booking.guestPhone,
      },
      include: { listing: { include: { host: true } }, roomType: { select: { name: true } } },
    });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const confirmationUrl = `${baseUrl}/bookings/${booking.id}/confirmation`;
  const stripe = getStripeClient();

  if (!stripe) {
    if (!allowsUnpaidConfirmation()) {
      return NextResponse.json({ error: PAYMENTS_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    // Stripe isn't configured (e.g. local dev without keys). Confirm directly
    // so the booking flow can still be exercised end to end.
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CONFIRMED", paymentStatus: "PAID", paidAt: new Date() },
    });
    await sendBookingConfirmedEmails({
      reference: booking.reference,
      listingTitle: booking.listing.title,
      city: booking.listing.city,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.nights,
      guests: booking.guests,
      totalPriceCents: booking.totalPriceCents,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      hostName: booking.listing.host.name,
      hostEmail: booking.listing.host.email,
      bookingUrl: `${baseUrl}/bookings/${booking.id}`,
    });
    await awardReferralBonusIfEligible(prisma, booking.guestId);
    return NextResponse.json({
      url: `${confirmationUrl}?dev_confirmed=1`,
      devMode: true,
    });
  }

  // A guest re-submitting (double-click, a second tab, hitting back then
  // forward) must never be handed a second live, payable session: that's a
  // real double-charge risk with two separate PaymentIntents, not just a
  // cosmetic duplicate. If a session from an earlier attempt is still
  // usable, send them back to that one instead of minting a new one.
  if (booking.stripeSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
    const action = decideExistingSessionAction(existingSession.status);
    if (action === "reuse" && existingSession.url) {
      return NextResponse.json({ url: existingSession.url });
    }
    if (action === "already_paid") {
      return NextResponse.json({ url: `${confirmationUrl}?success=1` });
    }
    // "create_new": the old session expired unpaid; fall through below.
  }

  const discountNote = booking.lengthOfStayDiscountLabel
    ? ` (${booking.lengthOfStayDiscountLabel} discount applied)`
    : "";
  const nightsLabel = `${booking.nights} night${booking.nights > 1 ? "s" : ""}${discountNote}`;
  const lineItemName = booking.roomType
    ? `${booking.listing.title} — ${booking.roomType.name} × ${booking.roomsBooked} room${booking.roomsBooked > 1 ? "s" : ""}: ${nightsLabel}`
    : `${booking.listing.title}: ${nightsLabel}`;

  const lineItems = [
    {
      price_data: {
        currency: "gbp",
        product_data: { name: lineItemName },
        unit_amount: discountedAccommodationCents(booking),
      },
      quantity: 1,
    },
  ];
  if (booking.cleaningFeeCents > 0) {
    lineItems.push({
      price_data: {
        currency: "gbp",
        product_data: { name: "Cleaning fee" },
        unit_amount: booking.cleaningFeeCents,
      },
      quantity: 1,
    });
  }
  if (booking.serviceFeeCents > 0) {
    lineItems.push({
      price_data: {
        currency: "gbp",
        product_data: { name: "FYStay service fee" },
        unit_amount: booking.serviceFeeCents,
      },
      quantity: 1,
    });
  }
  if (booking.taxCents > 0) {
    lineItems.push({
      price_data: {
        currency: "gbp",
        product_data: { name: "Taxes" },
        unit_amount: booking.taxCents,
      },
      quantity: 1,
    });
  }

  // Every paid booking is a destination charge: the host's share moves to
  // their Connect account as part of the payment and FYStay keeps its
  // service fee as the application fee. A host whose account can't receive
  // that right now (none, onboarding unfinished, or restricted - re-checked
  // live with Stripe here) can't take a payment at all, so no guest money
  // ever sits in FYStay's balance waiting to be paid out by hand.
  if (!(await verifyHostPaymentReady(booking.listing.host))) {
    return NextResponse.json({ error: HOST_NOT_PAYMENT_READY_MESSAGE }, { status: 409 });
  }
  // A referral credit and a promo code's discount (see referral.ts and
  // promoCode.ts) are both a marketing cost FYStay bears, not the host -
  // see applyDiscountsToApplicationFee's own comment for why their combined
  // total comes out of this fee first, not the host's transfer.
  const totalDiscountCents = booking.creditAppliedCents + booking.promoDiscountCents;
  const applicationFeeCents = applyDiscountsToApplicationFee(
    booking.serviceFeeCents + booking.taxCents,
    totalDiscountCents,
  );

  // The line items above total the pre-discount price; a one-off coupon
  // brings what's actually charged down to booking.totalPriceCents (already
  // net of both discounts - see /api/bookings), the same way Stripe
  // Checkout expects any discount to be represented, since a line item's
  // own unit_amount can never be negative. Referral credit and a promo code
  // can both apply to the same booking, so they're combined into one
  // coupon rather than two - Stripe Checkout only accepts a single discount
  // per session.
  const discountLabel =
    booking.creditAppliedCents > 0 && booking.promoDiscountCents > 0
      ? "Referral credit + promo code"
      : booking.promoDiscountCents > 0
        ? "Promo code"
        : "Referral credit";
  const discounts =
    totalDiscountCents > 0
      ? [
          {
            coupon: (
              await stripe.coupons.create({
                amount_off: totalDiscountCents,
                currency: "gbp",
                duration: "once",
                name: discountLabel,
              })
            ).id,
          },
        ]
      : undefined;

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: booking.guestEmail ?? undefined,
    line_items: lineItems,
    ...(discounts && { discounts }),
    metadata: { bookingId: booking.id },
    // About Stripe's shortest allowed lifetime, instead of its 24-hour default, so
    // an abandoned payment page can't be completed long after the date hold
    // ended. The webhook re-checks availability as the final safeguard.
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
    success_url: `${confirmationUrl}?success=1`,
    cancel_url: `${baseUrl}/checkout/${booking.id}?cancelled=1`,
    payment_intent_data: {
      application_fee_amount: applicationFeeCents,
      transfer_data: { destination: booking.listing.host.stripeConnectAccountId! },
    },
  });

  // Conditional on stripeSessionId still being what we read (unset, or an
  // earlier session that expired unpaid): if a concurrent request already
  // attached a different session in the moment between our read above and
  // this write, that session is the one the guest should actually pay
  // through, not the one this request just created.
  const attached = await prisma.booking.updateMany({
    where: { id: booking.id, stripeSessionId: booking.stripeSessionId },
    data: {
      stripeSessionId: checkoutSession.id,
      hostPaidViaConnect: true,
      applicationFeeCents,
    },
  });

  if (attached.count === 0) {
    const winner = await prisma.booking.findUnique({ where: { id: booking.id } });
    if (winner?.stripeSessionId) {
      const winningSession = await stripe.checkout.sessions.retrieve(winner.stripeSessionId);
      if (winningSession.url) {
        return NextResponse.json({ url: winningSession.url });
      }
    }
  }

  return NextResponse.json({ url: checkoutSession.url });
}

export const POST = withApiErrorHandling(postHandler);
