import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { BookingAlreadyProcessedError, cancelBookingAndRefund } from "@/lib/bookingCancellation";
import { withApiErrorHandling } from "@/lib/apiError";

const adminCancelSchema = z.object({
  reason: z.string().trim().min(3, "Give a short reason for this cancellation").max(500),
  // Omitted: falls back to the listing's own cancellation policy, exactly
  // like a guest-initiated cancellation. Provided: support's own goodwill/
  // manual override, capped like any real percentage.
  refundPercent: z.number().min(0).max(100).optional(),
});

/**
 * Support's manual cancel-and-refund action. Reuses cancelBookingAndRefund
 * (src/lib/bookingCancellation.ts) - the exact same Stripe refund, status
 * update, cancellation emails, and PMS push the guest-facing cancel route
 * triggers - rather than a second implementation of any of that. The only
 * thing unique to this route is who's allowed to call it (ADMIN only, any
 * PENDING/CONFIRMED booking - not gated by the guest-facing
 * "can I still cancel this myself" window in canCancelBooking) and the
 * reason/optional refund override support provides.
 *
 * Audit trail: this codebase has no generic admin-action/changelog table
 * today (see PaymentDispute/BookingChangeRequest - each existing history
 * table is purpose-built for its own feature, not a general-purpose log),
 * and adding one is explicitly out of scope here (product-strategy.md's
 * anti-gold-plating stance, and schema.prisma is off-limits for this task
 * to avoid migration conflicts with the parallel suspend/unsuspend work).
 * So the minimal note taken is a structured server log line recording who
 * cancelled what, why, and what refund was actually applied - visible in
 * this deployment's server logs, and a real persisted audit log is a
 * reasonable near-term addition once schema changes aren't contended.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = adminCancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { listing: { include: { host: true } } },
  });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
    return NextResponse.json(
      { error: `Booking is already ${booking.status.toLowerCase()} - nothing to cancel` },
      { status: 409 },
    );
  }

  const { reason, refundPercent } = parsed.data;
  let result;
  try {
    result = await cancelBookingAndRefund(prisma, booking, { refundPercentOverride: refundPercent });
  } catch (error) {
    if (error instanceof BookingAlreadyProcessedError) {
      return NextResponse.json(
        { error: "This booking was just cancelled by someone else - nothing more to do" },
        { status: 409 },
      );
    }
    throw error;
  }
  const { updated, refund } = result;

  console.log("[admin-booking-cancel]", {
    bookingId: booking.id,
    reference: booking.reference,
    adminId: session.user.id,
    adminEmail: session.user.email,
    reason,
    refundPercentOverride: refundPercent ?? null,
    refundCents: refund.refundCents,
    at: new Date().toISOString(),
  });

  return NextResponse.json({ booking: updated, refund });
}

export const POST = withApiErrorHandling(postHandler);
