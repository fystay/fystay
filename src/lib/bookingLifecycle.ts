import type { Booking, Listing, Prisma, PrismaClient, User } from "@prisma/client";

/**
 * FYStay has no background job runner, so a booking's move from CONFIRMED
 * to COMPLETED happens lazily: whenever a guest's bookings are about to be
 * read, first flip any of theirs whose stay has already ended. Cheap
 * (guestId-scoped, only touches rows that actually need it) and keeps the
 * stored status truthful without a scheduler.
 */
export async function completePastBookings(
  prisma: PrismaClient,
  guestId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.booking.updateMany({
    where: { guestId, status: "CONFIRMED", checkOut: { lte: now } },
    data: { status: "COMPLETED" },
  });
}

export type ExpiredBookingRequest = Booking & { listing: Listing & { host: User } };

/**
 * A request-to-book request (see Listing.instantBook) the host never
 * responded to within REQUEST_HOLD_HOURS. Same lazy-cleanup approach as
 * completePastBookings: called whenever a guest's or host's bookings are
 * about to be read (guestId/hostId scope), plus a daily cron sweep with no
 * scope for anyone who doesn't happen to check back (see
 * /api/cron/expire-booking-requests) - this app has no background job
 * runner to fire the moment a deadline actually passes.
 *
 * Any referral credit or promo code redemption the guest had spent on the
 * booking (see computeCreditToApply in referral.ts and applyPromoAndCredit
 * in api/bookings/route.ts) is refunded/released - unlike an instant-book
 * PENDING booking that simply goes unpaid, this guest did nothing wrong;
 * the host is the one who let the clock run out. Releasing the promo
 * redemption matters most for a capped code (PromoCode.maxRedemptions): a
 * string of never-answered requests would otherwise permanently burn
 * redemption slots nobody ever actually paid for.
 *
 * Returns the bookings it just expired (with listing/host attached) so a
 * caller that wants to notify the guest - only the cron sweep does today -
 * has what it needs without a second query.
 */
export async function expireStaleBookingRequests(
  prisma: PrismaClient,
  scope: { guestId?: string; hostId?: string } = {},
  now: Date = new Date(),
): Promise<ExpiredBookingRequest[]> {
  const stale = await prisma.booking.findMany({
    where: {
      status: "PENDING",
      approvalStatus: "AWAITING",
      requestExpiresAt: { lte: now },
      ...(scope.guestId && { guestId: scope.guestId }),
      ...(scope.hostId && { listing: { hostId: scope.hostId } }),
    },
    include: { listing: { include: { host: true } } },
  });

  const expired: ExpiredBookingRequest[] = [];
  for (const booking of stale) {
    // Claimed with the same conditions it was found by: the host may accept
    // or decline it, or another sweep (a guest page load and the cron at
    // once) may expire it, between the read above and this write. Only the
    // one request that actually flips it gives the credit and promo back,
    // so they're never returned twice.
    const claimed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: { id: booking.id, status: "PENDING", approvalStatus: "AWAITING", requestExpiresAt: { lte: now } },
        data: { status: "CANCELLED", approvalStatus: "EXPIRED", hostRespondedAt: now },
      });
      if (count === 0) return false;
      await giveBackReservedDiscounts(tx, booking);
      return true;
    });
    if (claimed) expired.push(booking);
  }

  return expired;
}

/**
 * Returns the referral credit and promo code redemption a booking reserved
 * when it was created (see applyPromoAndCredit in api/bookings/route.ts) -
 * for a booking that's ending without the guest ever paying for it. Callers
 * run it in the same transaction as the conditional status update that
 * claims the booking, and only when that update matched, so it happens at
 * most once per booking however many requests race to end it.
 */
export async function giveBackReservedDiscounts(
  tx: Prisma.TransactionClient,
  booking: Pick<Booking, "guestId" | "creditAppliedCents" | "promoCodeId">,
): Promise<void> {
  if (booking.creditAppliedCents > 0) {
    await tx.user.update({
      where: { id: booking.guestId },
      data: { creditBalanceCents: { increment: booking.creditAppliedCents } },
    });
  }
  if (booking.promoCodeId) {
    await tx.promoCode.update({
      where: { id: booking.promoCodeId },
      data: { redemptionCount: { decrement: 1 } },
    });
  }
}

/**
 * How long after an unpaid reservation was last touched it's treated as
 * abandoned. Comfortably past both the 30-minute date hold
 * (PENDING_BOOKING_HOLD_MINUTES) and the 31-minute life of any Stripe
 * payment page the guest opened for it (checkout sets the booking's
 * updatedAt when it attaches one), so a guest still paying is never
 * caught by it - and a payment page can't outlive it.
 */
export const ABANDONED_CHECKOUT_MINUTES = 60;

type UnpaidBooking = Pick<Booking, "id" | "guestId" | "creditAppliedCents" | "promoCodeId">;

/**
 * Closes a reservation that was never paid for: CANCELLED, and the
 * referral credit and promo code redemption it reserved are given back -
 * no money moved, so the guest loses nothing. Only acts on a booking that's
 * still PENDING and unpaid when the update runs (plus any extra condition
 * the caller passes, e.g. "this is still its current payment page"), so a
 * payment landing at the same moment wins and nothing is released twice.
 * Returns whether it closed the booking.
 */
export async function releaseUnpaidBooking(
  prisma: PrismaClient,
  booking: UnpaidBooking,
  onlyIf: Prisma.BookingWhereInput = {},
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { ...onlyIf, id: booking.id, status: "PENDING", paymentStatus: "UNPAID" },
      data: { status: "CANCELLED" },
    });
    if (count === 0) return false;
    await giveBackReservedDiscounts(tx, booking);
    return true;
  });
}

/**
 * Instant-book reservations (and approved requests) the guest never paid
 * for, ABANDONED_CHECKOUT_MINUTES after they were last touched - e.g. they
 * reserved and closed the tab before paying, so no Stripe payment page ever
 * existed to expire on its own. Without this they'd sit in "My trips" as
 * "Pending payment" for ever. Lazy, like completePastBookings (run when a
 * guest's or host's bookings are read), plus the daily cron sweep with no scope.
 */
export async function expireAbandonedCheckouts(
  prisma: PrismaClient,
  scope: { guestId?: string; hostId?: string } = {},
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_CHECKOUT_MINUTES * 60 * 1000);
  const abandoned = await prisma.booking.findMany({
    where: {
      status: "PENDING",
      paymentStatus: "UNPAID",
      approvalStatus: { in: ["NONE", "APPROVED"] },
      updatedAt: { lt: cutoff },
      ...(scope.guestId && { guestId: scope.guestId }),
      ...(scope.hostId && { listing: { hostId: scope.hostId } }),
    },
    select: { id: true, guestId: true, creditAppliedCents: true, promoCodeId: true },
  });
  let released = 0;
  for (const booking of abandoned) {
    if (await releaseUnpaidBooking(prisma, booking, { updatedAt: { lt: cutoff } })) released++;
  }
  return released;
}

/**
 * A reservation that ended without ever being paid - an abandoned or
 * expired checkout. It was never a trip, so "My trips" leaves it out
 * rather than listing it as a cancelled stay. (A declined or expired
 * request-to-book is still shown: the guest asked and deserves the answer.)
 */
export function isAbandonedReservation(booking: {
  status: string;
  paymentStatus: string;
  approvalStatus: string;
  paidAt: Date | null;
}): boolean {
  return (
    booking.status === "CANCELLED" &&
    booking.paymentStatus === "UNPAID" &&
    booking.paidAt === null &&
    booking.approvalStatus === "NONE"
  );
}
