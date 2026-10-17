import { applyDiscountsToApplicationFee, fyStayFeeCents } from "@/lib/pricing";

export type AdminBookingSummary = {
  paymentStatus: "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
  totalPriceCents: number;
  serviceFeeCents: number;
  hostCommissionCents: number;
  taxCents: number;
  creditAppliedCents: number;
  promoDiscountCents: number;
  /** Refunded to the guest so far (Booking.refundedAmountCents). */
  refundedAmountCents?: number | null;
};

export type PlatformFinancials = {
  /** Gross booking value: what guests have actually paid across every paid booking, lifetime, less what was refunded. */
  grossBookingValueCents: number;
  /**
   * What FYStay itself nets, not what the host earns: its commission (or an
   * older booking's guest service fee, + tax, always 0 today) minus any referral credit and promo discount
   * applied on that booking - both are the platform's own marketing cost,
   * never the host's (see applyDiscountsToApplicationFee in pricing.ts),
   * so they come out of this figure, not out of grossBookingValueCents.
   * Floored per-booking at 0 the same way that function is, since a
   * booking's combined discounts can in principle exceed its own fee. A
   * refund returns the same share of FYStay's fee as of the payment (Stripe's
   * refund_application_fee; hostRevenueCents does the same for the host),
   * so only the kept share counts. Stripe's own processing fees aren't
   * deducted here: they're FYStay's cost and aren't returned on refunds.
   */
  platformRevenueCents: number;
  paidBookingsCount: number;
};

/** UNPAID bookings (abandoned or still-pending requests) contribute nothing here - no money has moved yet. */
export function summarizePlatformFinancials(bookings: AdminBookingSummary[]): PlatformFinancials {
  let grossBookingValueCents = 0;
  let platformRevenueCents = 0;
  let paidBookingsCount = 0;

  for (const booking of bookings) {
    if (booking.paymentStatus === "UNPAID") continue;
    const refunded = Math.min(Math.max(0, booking.refundedAmountCents ?? 0), booking.totalPriceCents);
    const keptShare = booking.totalPriceCents > 0 ? 1 - refunded / booking.totalPriceCents : 0;
    grossBookingValueCents += booking.totalPriceCents - refunded;
    platformRevenueCents += Math.round(
      applyDiscountsToApplicationFee(fyStayFeeCents(booking), booking.creditAppliedCents + booking.promoDiscountCents) * keptShare,
    );
    paidBookingsCount += 1;
  }

  return { grossBookingValueCents, platformRevenueCents, paidBookingsCount };
}

export type AdminExtraSummary = {
  status: "PENDING_PAYMENT" | "PAID" | "CANCELLED" | "REFUNDED";
  priceCents: number;
};

export type ExtrasFinancials = {
  extrasRevenueCents: number;
  paidExtrasCount: number;
};

/**
 * Trip Extras (airport transfers, attraction tickets, car hire) run through
 * FYStay's own Stripe account, never Stripe Connect (see
 * src/app/api/bookings/[id]/extras/route.ts's own comment) - a paid
 * extra's full price is FYStay's own revenue today, not split with a host
 * or the third-party provider (Phase 1 fulfillment pays providers off-
 * platform), so this is a plain sum rather than the fee-minus-discounts
 * shape summarizePlatformFinancials uses for bookings.
 */
export function summarizeExtrasRevenue(extras: AdminExtraSummary[]): ExtrasFinancials {
  let extrasRevenueCents = 0;
  let paidExtrasCount = 0;

  for (const extra of extras) {
    if (extra.status !== "PAID") continue;
    extrasRevenueCents += extra.priceCents;
    paidExtrasCount += 1;
  }

  return { extrasRevenueCents, paidExtrasCount };
}
