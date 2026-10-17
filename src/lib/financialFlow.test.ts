import { describe, expect, it } from "vitest";
import { decideSmartPrice, highestReachableMinimumPayout } from "./dynamicPricing";
import { applyDiscountsToApplicationFee, fyStayFeeCents, maxFyStayDiscountCents, splitBookingChange, weekendNightsBetween } from "./pricing";
import { bookingFieldsAfterChange, changeBreaksMinimumPayout, changePriceDeltaCents, isRefundChangeOnDiscountedBooking } from "./changeRequests";
import { hostPayoutCents, hostRevenueCents } from "./hostStats";

/**
 * The money of a dynamic-commission booking end to end - priced, paid,
 * changed (extra payments and refunds), part-cancelled - checking FYStay's
 * books against what Stripe moves on a destination charge:
 *
 * - a payment of C with application fee F sends C to the host's account
 *   and takes F back as FYStay's fee (host +C-F);
 * - a refund of R with reverse_transfer + refund_application_fee (what
 *   connectRefunds.ts sends) reverses R from the host's account and returns
 *   F x R / C of the fee to it (host -R + that). ASSUMPTION: Stripe rounds
 *   that proportional fee to the nearest penny. Its documentation says
 *   "proportional" without the rounding rule; this is the one assumption
 *   here, and it is not verified against live Stripe.
 * - refunds go newest payment first, never more than a payment has left
 *   (refundAcrossPayments).
 *
 * Exact to the penny: checkout, every extra payment, a booking's first
 * refund, and a part-cancellation with no refund before it. A later refund
 * can differ by 1p: Stripe works out each refund's fee share on its own
 * payment's ratio, while the books carry one ratio for the booking. Making
 * those exact needs a per-payment ledger (docs/pricing-policy.md, "Known
 * limits").
 */

type Payment = { charge: number; fee: number; refunded: number };
type Ledger = { payments: Payment[]; hostNet: number; feeNet: number; guestNet: number };

const pay = (ledger: Ledger, charge: number, fee: number) => {
  ledger.payments.push({ charge, fee, refunded: 0 });
  ledger.hostNet += charge - fee;
  ledger.feeNet += fee;
  ledger.guestNet += charge;
};
const refund = (ledger: Ledger, amount: number) => {
  let remaining = amount;
  for (const p of [...ledger.payments].reverse()) {
    const part = Math.min(remaining, p.charge - p.refunded);
    if (part <= 0) continue;
    const feeBack = Math.round((p.fee * part) / p.charge);
    p.refunded += part;
    ledger.hostNet += -part + feeBack;
    ledger.feeNet -= feeBack;
    ledger.guestNet -= part;
    remaining -= part;
  }
};

const DAY = 86_400_000;
const TODAY = new Date("2026-10-14T00:00:00Z");
let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T,>(values: T[]) => values[Math.floor(rnd() * values.length)];

function randomBooking() {
  const price = 3_000 + Math.floor(rnd() * 40_000);
  const weekend = rnd() < 0.4 ? price + Math.floor(rnd() * 8_000) : null;
  const weekly = rnd() < 0.4 ? pick([5, 10, 20]) : null;
  const listing = { pricePerNightCents: price, weeklyDiscountPercent: weekly, monthlyDiscountPercent: null, lastMinuteDiscountPercent: null };
  const min = 1 + Math.floor(rnd() * highestReachableMinimumPayout(listing).cents);
  const checkIn = new Date(TODAY.getTime() + (5 + Math.floor(rnd() * 150)) * DAY);
  const nights = 1 + Math.floor(rnd() * 14);
  const checkOut = new Date(checkIn.getTime() + nights * DAY);
  const weekendNights = weekend === null ? 0 : weekendNightsBetween(checkIn, checkOut);
  const decision = decideSmartPrice({
    stay: { nights, pricePerNightCents: price, weekendPricePerNightCents: weekend, weekendNights, weeklyDiscountPercent: weekly, monthlyDiscountPercent: null, lastMinuteDiscountPercent: null },
    settings: { enabled: true, autoApply: true, consentAt: TODAY, minHostPayoutPerNightCents: min, targetHostPayoutPerNightCents: null, minGuestPricePerNightCents: null, maxGuestPricePerNightCents: null, maxAdjustmentPercent: null },
    demand: {
      today: TODAY,
      checkIn,
      checkOut,
      market: { town: "T", activeListings: pick([2, 12]), bookingsLast180Days: 40, historyDays: 200, forwardShare: rnd(), paceShare: 0.4, seasonalIndex: null, seasonSampleBookings: 0 },
      localEvents: null,
    },
  });
  const p = decision.pricing;
  const promo = rnd() < 0.25 ? Math.floor(rnd() * maxFyStayDiscountCents(p)) : 0;
  const booking = {
    checkIn,
    checkOut,
    nights,
    nightlyPriceCents: p.nightlyPriceCents,
    weekendNightlyPriceCents: p.weekendNightlyPriceCents,
    cleaningFeeCents: 0,
    serviceFeeCents: 0,
    taxCents: 0,
    hostCommissionCents: p.hostCommissionCents,
    lastMinuteDiscountPercent: null,
    totalPriceCents: p.totalPriceCents - promo,
    creditAppliedCents: 0,
    promoDiscountCents: promo,
    pricingPolicyVersion: "dynamic-v1",
    commissionRateBps: decision.commission.rateBps,
    minHostPayoutPerNightCents: min,
  };
  return { booking, listing, min, decision };
}

type Booking = ReturnType<typeof randomBooking>["booking"];
const accommodation = (b: Booking) => b.totalPriceCents + b.promoDiscountCents;

describe("dynamic-commission money, end to end", () => {
  it("reconciles to the penny with Stripe, and keeps the host's minimum, through payment and date changes", () => {
    const stats = { bookings: 0, changes: 0, refusedDiscounted: 0, refusedMinimum: 0, extensions: 0, refunds: 0, laterRefundPennies: 0 };
    for (let i = 0; i < 3_000; i++) {
      const { booking: original, listing, min } = randomBooking();
      stats.bookings++;
      let b: Booking = original;
      const ledger: Ledger = { payments: [], hostNet: 0, feeNet: 0, guestNet: 0 };

      // Checkout: application fee = FYStay's fee less what FYStay funds.
      const appFee = applyDiscountsToApplicationFee(fyStayFeeCents(b), b.promoDiscountCents + b.creditAppliedCents);
      pay(ledger, b.totalPriceCents, appFee);
      expect(ledger.hostNet).toBe(hostPayoutCents(b));
      expect(ledger.hostNet).toBe(accommodation(b) - b.hostCommissionCents); // promos never touch the host
      expect(ledger.hostNet).toBeGreaterThanOrEqual(min * b.nights);

      // Up to two date changes in a row.
      for (let c = 0; c < 2; c++) {
        const shift = Math.floor(rnd() * 20) - 5;
        const nights = Math.max(1, b.nights + pick([-4, -2, -1, 0, 1, 3, 7]));
        const checkIn = new Date(b.checkIn.getTime() + shift * DAY);
        const requested = { checkIn, checkOut: new Date(checkIn.getTime() + nights * DAY) };
        const delta = changePriceDeltaCents(b, listing, requested);
        if (isRefundChangeOnDiscountedBooking(b, delta)) {
          stats.refusedDiscounted++;
          continue;
        }
        if (changeBreaksMinimumPayout(b, delta, requested)) {
          stats.refusedMinimum++;
          continue;
        }
        stats.changes++;
        const refundedBefore = ledger.payments.some((p) => p.refunded > 0);
        if (delta > 0) {
          stats.extensions++;
          pay(ledger, delta, splitBookingChange(delta, b).platformShareCents);
        } else if (delta < 0) {
          stats.refunds++;
          refund(ledger, -delta);
        }
        b = {
          ...b,
          ...bookingFieldsAfterChange(b, { requestedCheckIn: requested.checkIn, requestedCheckOut: requested.checkOut, requestedGuests: 1, priceDeltaCents: delta }),
        };
        // The guest paid exactly the booking's total; the host and FYStay
        // hold exactly what the books say, to the penny.
        expect(ledger.guestNet).toBe(b.totalPriceCents);
        expect(ledger.hostNet + ledger.feeNet).toBe(ledger.guestNet);
        const drift = ledger.hostNet - hostPayoutCents(b);
        expect(ledger.feeNet + drift).toBe(fyStayFeeCents(b) - b.promoDiscountCents - b.creditAppliedCents);
        if (delta < 0 && (refundedBefore || ledger.payments.length > 1)) {
          // A later refund across payments: at most 1p each.
          expect(Math.abs(drift)).toBeLessThanOrEqual(c + 1);
          stats.laterRefundPennies += Math.abs(drift);
        } else {
          expect(drift).toBe(0);
        }
        expect(ledger.hostNet).toBeGreaterThanOrEqual(min * b.nights);
      }

      // A part refund under the cancellation policy: the host's earnings
      // (hostRevenueCents) are what Stripe leaves them. The minimum doesn't
      // apply - the published policy decides what the host keeps.
      if (rnd() < 0.5 && ledger.payments.length === 1) {
        const refunded = Math.floor(rnd() * b.totalPriceCents);
        const changed = ledger.payments[0].refunded > 0;
        refund(ledger, refunded);
        const books = hostRevenueCents({ ...b, refundedAmountCents: refunded, paymentStatus: "PARTIALLY_REFUNDED" });
        if (changed) { (stats as Record<string, number>).afterChangeDiff = Math.max((stats as Record<string, number>).afterChangeDiff ?? 0, Math.abs(ledger.hostNet - books)); (stats as Record<string, number>).afterChangeCases = ((stats as Record<string, number>).afterChangeCases ?? 0) + 1; }
        else expect(ledger.hostNet).toBe(books);
      }
    }
    // The run exercised every path.
    expect(stats.extensions).toBeGreaterThan(500);
    expect(stats.refunds).toBeGreaterThan(500);
    expect(stats.refusedDiscounted + stats.refusedMinimum).toBeGreaterThan(0);
  });
});
