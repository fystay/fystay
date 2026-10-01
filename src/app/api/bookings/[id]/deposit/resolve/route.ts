import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { sendDepositResolvedEmail } from "@/lib/notificationEmails";
import { withApiErrorHandling } from "@/lib/apiError";
import { BASE_URL } from "@/lib/baseUrl";

const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("release") }),
  z.object({
    action: z.literal("capture"),
    amountCents: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000),
  }),
]);

/**
 * A host releasing or claiming an AUTHORIZED security deposit hold. Release
 * is always available (a host can let a guest off the hook early);
 * capturing requires a reason, since - unlike everything else this app
 * charges - this is money taken because the host says something went
 * wrong, not because of an agreed price, so the guest is owed an
 * explanation for what they'll see on their card statement.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Security deposits are not available right now" }, { status: 501 });
  }

  const body = await request.json();
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { listing: { include: { host: true } } },
  });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.depositStatus !== "AUTHORIZED" || !booking.stripeDepositPaymentIntentId) {
    return NextResponse.json({ error: "There's no active deposit hold on this booking" }, { status: 409 });
  }
  if (parsed.data.action === "capture" && parsed.data.amountCents > booking.securityDepositCents) {
    return NextResponse.json(
      { error: "You can't claim more than the authorized deposit amount" },
      { status: 400 },
    );
  }

  const emailCtx = {
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
    bookingUrl: `${BASE_URL}/bookings/${booking.id}`,
  };

  if (parsed.data.action === "release") {
    await stripe.paymentIntents.cancel(booking.stripeDepositPaymentIntentId);
    await prisma.booking.update({
      where: { id },
      data: { depositStatus: "RELEASED", depositReleasedAt: new Date() },
    });
    await sendDepositResolvedEmail(emailCtx, { outcome: "released", depositCents: booking.securityDepositCents });
    return NextResponse.json({ status: "released" });
  }

  await stripe.paymentIntents.capture(booking.stripeDepositPaymentIntentId, {
    amount_to_capture: parsed.data.amountCents,
  });
  await prisma.booking.update({
    where: { id },
    data: {
      depositStatus: "CAPTURED",
      depositCapturedCents: parsed.data.amountCents,
      depositCapturedAt: new Date(),
    },
  });
  await sendDepositResolvedEmail(emailCtx, {
    outcome: "captured",
    depositCents: booking.securityDepositCents,
    capturedCents: parsed.data.amountCents,
    reason: parsed.data.reason,
  });

  return NextResponse.json({ status: "captured" });
}

export const POST = withApiErrorHandling(postHandler);
