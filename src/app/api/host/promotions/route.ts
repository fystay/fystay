import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { allowsUnpaidConfirmation, getStripeClient } from "@/lib/stripe";
import { hostAcceptsPaidBookings } from "@/lib/stripeConnect";
import { decideExistingSessionAction } from "@/lib/checkoutSession";
import { BASE_URL } from "@/lib/baseUrl";
import { formatDate } from "@/lib/format";
import {
  activatePaidPromotion,
  findPromotionPlan,
  PROMOTION_PLAN_KEYS,
  promotionIneligibilityReason,
  promotionWindow,
  spotlightAvailability,
} from "@/lib/listingPromotions";
import { notifyListingPromotionActivated } from "@/lib/listingPromotionNotifications";

const purchaseSchema = z.object({
  listingId: z.string().min(1),
  plan: z.enum(PROMOTION_PLAN_KEYS),
});

// An unpaid checkout for the same listing and plan younger than this is
// offered again rather than starting a second chargeable one (Stripe's own
// Checkout Sessions last 24 hours).
const REUSE_PENDING_WITHIN_MS = 23 * 60 * 60 * 1000;

/**
 * Starts a Spotlight purchase for one of the signed-in host's listings (see
 * src/lib/listingPromotions.ts): creates the placement as PENDING_PAYMENT
 * and a Stripe Checkout Session charged to FYStay's own account. The
 * webhook marks it paid and gives it its dates. The price always comes from
 * the server-side plan, never the request.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "HOST") {
    return NextResponse.json({ error: "Only hosts can feature listings." }, { status: 403 });
  }

  const parsed = purchaseSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a listing and a Spotlight plan." }, { status: 400 });
  }
  const plan = findPromotionPlan(parsed.data.plan)!;

  const listing = await prisma.listing.findUnique({
    where: { id: parsed.data.listingId },
    select: {
      id: true,
      title: true,
      hostId: true,
      published: true,
      suspendedAt: true,
      host: {
        select: { email: true, stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true },
      },
    },
  });
  // Someone else's listing reads as missing, so ids can't be probed.
  if (!listing || listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const ineligible = promotionIneligibilityReason(listing, hostAcceptsPaidBookings(listing.host));
  if (ineligible) {
    return NextResponse.json({ error: ineligible }, { status: 409 });
  }

  const stripe = getStripeClient();
  // Same rule as every other checkout: no Stripe key on a production
  // deployment means payments aren't available, never that it's free.
  if (!stripe && !allowsUnpaidConfirmation()) {
    return NextResponse.json(
      { error: "Online payment isn't available yet, so Spotlight can't be bought. Please try again later." },
      { status: 503 },
    );
  }

  const now = new Date();
  const existingPaid = await prisma.listingPromotion.findMany({
    where: { listingId: listing.id, status: "PAID" },
    select: { endsAt: true },
  });
  const window = promotionWindow(now, plan.days, existingPaid.map((p) => p.endsAt));
  const { available, nextFreeAt } = await spotlightAvailability(prisma, window, listing.id);
  if (!available) {
    return NextResponse.json(
      {
        error: nextFreeAt
          ? `All Spotlight spots are taken until ${formatDate(nextFreeAt)}. Please try again then.`
          : "All Spotlight spots are taken right now. Please try again soon.",
      },
      { status: 409 },
    );
  }

  // A double-click or a second tab goes back to the same unpaid checkout.
  if (stripe) {
    const pending = await prisma.listingPromotion.findFirst({
      where: {
        listingId: listing.id,
        hostId: session.user.id,
        plan: plan.key,
        status: "PENDING_PAYMENT",
        stripeSessionId: { not: null },
        createdAt: { gt: new Date(now.getTime() - REUSE_PENDING_WITHIN_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (pending?.stripeSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(pending.stripeSessionId);
      const action = decideExistingSessionAction(existing.status);
      if (action === "reuse" && existing.url) return NextResponse.json({ url: existing.url });
      if (action === "already_paid") {
        return NextResponse.json(
          { error: "That payment has already gone through - refresh the page in a moment." },
          { status: 409 },
        );
      }
    }
  }

  const promotion = await prisma.listingPromotion.create({
    data: {
      listingId: listing.id,
      hostId: session.user.id,
      plan: plan.key,
      days: plan.days,
      priceCents: plan.priceCents,
    },
  });

  if (!stripe) {
    // No Stripe key on a non-production deployment (local development, CI):
    // activate straight away, the same fallback every other checkout uses,
    // so the whole feature can be exercised without real keys.
    const activated = await activatePaidPromotion(prisma, promotion.id, null, now);
    if (activated) await notifyListingPromotionActivated(promotion.id);
    return NextResponse.json({ devMode: true, startsAt: activated?.startsAt, endsAt: activated?.endsAt });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: listing.host.email,
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Spotlight stays: ${listing.title}`,
            description: `${plan.label} featured on the FYStay homepage`,
          },
          unit_amount: plan.priceCents,
        },
        quantity: 1,
      },
    ],
    metadata: { purpose: "listing_promotion", promotionId: promotion.id },
    success_url: `${BASE_URL}/host/promote?success=1`,
    cancel_url: `${BASE_URL}/host/promote?cancelled=1`,
  });

  await prisma.listingPromotion.update({
    where: { id: promotion.id },
    data: { stripeSessionId: checkoutSession.id },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

export const POST = withApiErrorHandling(postHandler);
