import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real Stripe signatures: events are signed with Stripe's own test helper
// and checked by the route's real stripe.webhooks.constructEvent.
const SECRET = "whsec_test_secret";
const realStripe = new Stripe("sk_test_dummy");

const { mocks, state } = vi.hoisted(() => ({
  mocks: {
    confirmedEmails: vi.fn(),
    unavailableEmails: vi.fn(),
    opsAlerts: vi.fn(),
    refundAcrossPayments: vi.fn(),
    refundsList: vi.fn(),
    notifyTripExtraPaid: vi.fn(),
    applyApprovedChange: vi.fn(),
    giveBack: vi.fn(),
  },
  state: {
    booking: null as null | Record<string, unknown>,
    extra: null as null | Record<string, unknown>,
    alerts: new Set<string>(),
    available: true,
    // What happened, in order: lets a test see the availability check ran
    // inside the listing lock, not before or after it.
    log: [] as string[],
  },
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => {
    const client = new Stripe("sk_test_dummy");
    (client.refunds as unknown as { list: unknown }).list = mocks.refundsList;
    return client;
  },
}));
vi.mock("@/lib/notificationEmails", () => ({
  sendBookingConfirmedEmails: (...a: unknown[]) => mocks.confirmedEmails(...a),
  sendBookingUnavailableRefundedEmail: (...a: unknown[]) => mocks.unavailableEmails(...a),
  sendDisputeAlertEmail: vi.fn(),
  sendPaymentOpsAlertEmail: (...a: unknown[]) => mocks.opsAlerts(...a),
}));
vi.mock("@/lib/connectRefunds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/connectRefunds")>()),
  refundAcrossPayments: (...a: unknown[]) => mocks.refundAcrossPayments(...a),
}));
vi.mock("@/lib/referral", () => ({ awardReferralBonusIfEligible: vi.fn() }));
vi.mock("@/lib/pms/sync", () => ({ pushBookingReservation: vi.fn() }));
vi.mock("@/lib/availability", () => ({
  isRequestedRangeStillAvailable: async () => {
    state.log.push("availability-check");
    return state.available;
  },
}));
vi.mock("@/lib/availabilityLock", () => ({
  withListingAvailabilityLock: async (db: unknown, listingId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.log.push(`lock:${listingId}`);
    const result = await fn(db);
    state.log.push(`unlock:${listingId}`);
    return result;
  },
}));
vi.mock("@/lib/stripeConnect", () => ({ refreshConnectAccountStatus: vi.fn() }));
vi.mock("@/lib/listingPromotions", () => ({ activatePaidPromotion: vi.fn() }));
vi.mock("@/lib/listingPromotionNotifications", () => ({ notifyListingPromotionActivated: vi.fn() }));
vi.mock("@/lib/bookingLifecycle", () => ({
  releaseUnpaidBooking: vi.fn(),
  giveBackReservedDiscounts: (...a: unknown[]) => mocks.giveBack(...a),
}));
vi.mock("@/app/api/bookings/[id]/change-requests/[requestId]/pay/route", () => ({
  applyApprovedChange: (...a: unknown[]) => mocks.applyApprovedChange(...a),
}));
vi.mock("@/app/api/bookings/[id]/extras/route", () => ({
  notifyTripExtraPaid: (...a: unknown[]) => mocks.notifyTripExtraPaid(...a),
}));
vi.mock("@/lib/prisma", async () => {
  const { Prisma } = await import("@prisma/client");
  const listing = { title: "Seaside flat", city: "Blackpool", host: { name: "Host", email: "host@example.com" } };
  const prisma: Record<string, unknown> = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    bookingExtra: {
      findUnique: async () => (state.extra ? { ...state.extra } : null),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        const extra = state.extra!;
        const status = where.status as string | { in: string[] };
        const statusOk = typeof status === "string" ? extra.status === status : status.in.includes(extra.status as string);
        const bookingWhere = where.booking as { status: string } | undefined;
        const bookingOk = !bookingWhere || state.booking!.status === bookingWhere.status;
        const priceOk = where.priceCents === undefined || where.priceCents === extra.priceCents;
        if (!statusOk || !bookingOk || !priceOk) return { count: 0 };
        Object.assign(extra, data);
        return { count: 1 };
      },
    },
  };
  Object.assign(prisma, {
      booking: {
        findUnique: async ({ select }: { select?: object }) =>
          state.booking ? (select ? { ...state.booking } : { ...state.booking, listing }) : null,
        findUniqueOrThrow: async () => ({ ...state.booking, listing }),
        findFirst: async () => (state.booking ? { reference: state.booking.reference } : null),
        updateMany: async ({ where, data }: { where: { status: string | { in: string[] } }; data: object }) => {
          const b = state.booking!;
          const ok = typeof where.status === "string" ? b.status === where.status : where.status.in.includes(b.status as string);
          if (!ok) return { count: 0 };
          state.log.push(`booking-write:${(data as { status?: string }).status}`);
          Object.assign(b, data);
          return { count: 1 };
        },
      },
      user: { update: vi.fn() },
      paymentAlertSent: {
        delete: async ({ where }: { where: { key: string } }) => {
          state.alerts.delete(where.key);
        },
        create: async ({ data }: { data: { key: string } }) => {
          if (state.alerts.has(data.key)) {
            throw new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "test" });
          }
          state.alerts.add(data.key);
          return data;
        },
      },
  });
  return { prisma };
});

import { POST } from "./route";

function signedRequest(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const signature = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://x/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}

const event = (type: string, object: object, id = `evt_${Math.random()}`) => ({
  id,
  object: "event",
  type,
  api_version: "2026-08-26",
  created: 1,
  data: { object },
});

const paidSession = (overrides: object = {}) => ({
  id: "cs_1",
  object: "checkout.session",
  payment_status: "paid",
  amount_total: 50_000,
  currency: "gbp",
  payment_intent: "pi_1",
  metadata: { bookingId: "bk_1" },
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.values(mocks).forEach((m) => m.mockReset());
  state.alerts.clear();
  state.available = true;
  state.log = [];
  state.extra = null;
  state.booking = {
    id: "bk_1",
    reference: "FY-ABC",
    status: "PENDING",
    paymentStatus: "UNPAID",
    totalPriceCents: 50_000,
    creditAppliedCents: 0,
    promoCodeId: null,
    hostPaidViaConnect: true,
    stripePaymentIntentId: null,
    guestId: "guest_1",
    listingId: "listing_1",
    roomTypeId: null,
    roomsBooked: 1,
    checkIn: new Date("2026-11-01"),
    checkOut: new Date("2026-11-03"),
  };
});

describe("signature verification", () => {
  it("rejects a missing, forged or wrongly-signed event and changes nothing", async () => {
    const body = JSON.stringify(event("checkout.session.completed", paidSession()));
    expect((await POST(new Request("http://x", { method: "POST", body }))).status).toBe(400);
    expect(
      (await POST(new Request("http://x", { method: "POST", headers: { "stripe-signature": "t=1,v1=forged" }, body })))
        .status,
    ).toBe(400);
    expect((await POST(signedRequest(event("checkout.session.completed", paidSession()), "whsec_attacker"))).status).toBe(400);
    expect(state.booking!.status).toBe("PENDING");
  });
});

describe("checkout.session.completed", () => {
  it("confirms a paid booking once, even when Stripe delivers the event twice", async () => {
    const delivered = event("checkout.session.completed", paidSession(), "evt_same");
    expect((await POST(signedRequest(delivered))).status).toBe(200);
    expect((await POST(signedRequest(delivered))).status).toBe(200);
    expect(state.booking).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID", stripePaymentIntentId: "pi_1" });
    expect(mocks.confirmedEmails).toHaveBeenCalledTimes(1);
  });

  it("never confirms an unpaid session", async () => {
    await POST(signedRequest(event("checkout.session.completed", paidSession({ payment_status: "unpaid" }))));
    expect(state.booking!.status).toBe("PENDING");
    expect(mocks.confirmedEmails).not.toHaveBeenCalled();
  });

  it("refunds instead of confirming when the amount paid isn't the booking's total", async () => {
    await POST(signedRequest(event("checkout.session.completed", paidSession({ amount_total: 500 }))));
    expect(state.booking).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED" });
    expect(mocks.refundAcrossPayments).toHaveBeenCalledWith(
      expect.anything(),
      [{ paymentIntentId: "pi_1", viaConnect: true }],
      500,
      "unconfirmable-payment:bk_1",
    );
    expect(mocks.confirmedEmails).not.toHaveBeenCalled();
    expect(mocks.unavailableEmails).not.toHaveBeenCalled();
  });

  it("refunds instead of confirming when the currency is wrong", async () => {
    await POST(signedRequest(event("checkout.session.completed", paidSession({ currency: "usd" }))));
    expect(state.booking!.status).toBe("CANCELLED");
  });

  it("re-checks availability and confirms inside the listing's availability lock", async () => {
    await POST(signedRequest(event("checkout.session.completed", paidSession())));
    expect(state.log).toEqual(["lock:listing_1", "availability-check", "booking-write:CONFIRMED", "unlock:listing_1"]);
  });

  it("refunds, and gives back the credit and promo, when the dates were taken after the hold lapsed", async () => {
    state.available = false;
    Object.assign(state.booking!, { creditAppliedCents: 1_500, promoCodeId: "promo_1" });
    await POST(signedRequest(event("checkout.session.completed", paidSession())));
    expect(state.booking).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED" });
    expect(state.log.indexOf("availability-check")).toBeLessThan(state.log.indexOf("unlock:listing_1"));
    expect(mocks.refundAcrossPayments).toHaveBeenCalledWith(
      expect.anything(),
      [{ paymentIntentId: "pi_1", viaConnect: true }],
      50_000,
      "unconfirmable-payment:bk_1",
    );
    expect(mocks.giveBack).toHaveBeenCalledTimes(1);
    expect(mocks.giveBack.mock.calls[0][1]).toMatchObject({ creditAppliedCents: 1_500, promoCodeId: "promo_1" });
    expect(mocks.unavailableEmails).toHaveBeenCalledTimes(1);
    expect(mocks.confirmedEmails).not.toHaveBeenCalled();
  });

  it("refunds a payment that lands on a booking already cancelled, once", async () => {
    state.booking!.status = "CANCELLED";
    const delivered = event("checkout.session.completed", paidSession(), "evt_cancelled");
    await POST(signedRequest(delivered));
    await POST(signedRequest(delivered));
    expect(mocks.refundAcrossPayments).toHaveBeenCalledTimes(1);
    expect(state.booking).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED" });
    // Never PENDING when the payment landed, so nothing was reserved to give back.
    expect(mocks.giveBack).not.toHaveBeenCalled();
  });

  it("ignores a redelivered payment for a booking that was paid, confirmed and later cancelled", async () => {
    // Cancelled under a 50% policy: half was already refunded by the
    // cancellation, and the redelivery must not refund the rest.
    Object.assign(state.booking!, {
      status: "CANCELLED",
      paymentStatus: "PARTIALLY_REFUNDED",
      paidAt: new Date("2026-10-01"),
      stripePaymentIntentId: "pi_1",
      refundedAmountCents: 25_000,
    });
    await POST(signedRequest(event("checkout.session.completed", paidSession())));
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
    expect(state.booking).toMatchObject({ paymentStatus: "PARTIALLY_REFUNDED", refundedAmountCents: 25_000 });

    // ...and the same under a 0% policy, where nothing was refunded.
    Object.assign(state.booking!, { paymentStatus: "PAID", refundedAmountCents: 0 });
    await POST(signedRequest(event("checkout.session.completed", paidSession())));
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
    expect(state.booking!.paymentStatus).toBe("PAID");
  });

  it("refunds a different, second payment on a paid-then-cancelled booking without overwriting its record", async () => {
    Object.assign(state.booking!, {
      status: "CANCELLED",
      paymentStatus: "PAID",
      paidAt: new Date("2026-10-01"),
      stripePaymentIntentId: "pi_first",
    });
    await POST(signedRequest(event("checkout.session.completed", paidSession({ payment_intent: "pi_2" }))));
    expect(mocks.refundAcrossPayments).toHaveBeenCalledWith(
      expect.anything(),
      [{ paymentIntentId: "pi_2", viaConnect: true }],
      50_000,
      "unconfirmable-payment:bk_1:pi_2",
    );
    expect(state.booking).toMatchObject({ paymentStatus: "PAID", stripePaymentIntentId: "pi_first" });
  });
});

describe("date-change payments", () => {
  it("passes what Stripe actually took, so applyApprovedChange can refund a wrong amount", async () => {
    await POST(
      signedRequest(
        event("checkout.session.completed", paidSession({ amount_total: 7_000, metadata: { changeRequestId: "cr_1" } })),
      ),
    );
    expect(mocks.applyApprovedChange).toHaveBeenCalledWith("cr_1", "pi_1", {
      amountCents: 7_000,
      currency: "gbp",
      sessionId: "cs_1",
    });
  });
});

describe("trip extra payments", () => {
  const extraSession = (overrides: object = {}) =>
    paidSession({ amount_total: 4_000, metadata: { purpose: "trip_extra", bookingExtraId: "ex_1" }, ...overrides });

  beforeEach(() => {
    state.booking!.status = "CONFIRMED";
    state.extra = { id: "ex_1", priceCents: 4_000, status: "PENDING_PAYMENT", stripePaymentIntentId: null };
  });

  it("records a correct payment on a confirmed stay as paid, once", async () => {
    const delivered = event("checkout.session.completed", extraSession(), "evt_extra");
    await POST(signedRequest(delivered));
    await POST(signedRequest(delivered));
    expect(state.extra).toMatchObject({ status: "PAID", stripePaymentIntentId: "pi_1" });
    expect(mocks.notifyTripExtraPaid).toHaveBeenCalledTimes(1);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
  });

  it("refunds instead when the booking was cancelled while the payment page was open", async () => {
    state.booking!.status = "CANCELLED";
    await POST(signedRequest(event("checkout.session.completed", extraSession())));
    expect(state.extra).toMatchObject({ status: "REFUNDED", stripePaymentIntentId: "pi_1" });
    expect(mocks.refundAcrossPayments).toHaveBeenCalledWith(
      expect.anything(),
      [{ paymentIntentId: "pi_1", viaConnect: false }],
      4_000,
      "trip-extra-refund:ex_1",
    );
    expect(mocks.notifyTripExtraPaid).not.toHaveBeenCalled();
  });

  it("refunds instead when Stripe took the wrong amount", async () => {
    await POST(signedRequest(event("checkout.session.completed", extraSession({ amount_total: 400 }))));
    expect(state.extra!.status).toBe("REFUNDED");
    expect(mocks.refundAcrossPayments.mock.calls[0][2]).toBe(400);
    expect(mocks.notifyTripExtraPaid).not.toHaveBeenCalled();
  });

  it("refunds a second payment for an extra that's already paid, without touching the paid record", async () => {
    Object.assign(state.extra!, { status: "PAID", stripePaymentIntentId: "pi_first" });
    await POST(signedRequest(event("checkout.session.completed", extraSession())));
    expect(mocks.refundAcrossPayments).toHaveBeenCalledTimes(1);
    expect(state.extra).toMatchObject({ status: "PAID", stripePaymentIntentId: "pi_first" });
  });
});

describe("refund alerts", () => {
  const charge = { id: "ch_1", object: "charge", payment_intent: "pi_1" };

  it("alerts once about a refund made in the Stripe Dashboard", async () => {
    mocks.refundsList.mockResolvedValue({
      data: [{ id: "re_dash", amount: 10_000, status: "succeeded", metadata: {} }],
    });
    await POST(signedRequest(event("charge.refunded", charge)));
    await POST(signedRequest(event("charge.refunded", charge)));
    expect(mocks.opsAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.opsAlerts).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Refund made outside FYStay", amountCents: 10_000, bookingReference: "FY-ABC" }),
    );
  });

  it("stays quiet about FYStay's own refunds", async () => {
    mocks.refundsList.mockResolvedValue({
      data: [{ id: "re_ours", amount: 25_000, status: "succeeded", metadata: { source: "fystay" } }],
    });
    await POST(signedRequest(event("charge.refunded", charge)));
    expect(mocks.opsAlerts).not.toHaveBeenCalled();
  });

  it("still sends the alert on Stripe's retry if the first email attempt failed", async () => {
    const refund = { id: "re_retry", object: "refund", amount: 1_000, payment_intent: "pi_1", failure_reason: null };
    mocks.opsAlerts.mockRejectedValueOnce(new Error("email provider down"));
    // A 500 is what makes Stripe deliver the event again.
    expect((await POST(signedRequest(event("refund.failed", refund)))).status).toBe(500);
    await POST(signedRequest(event("refund.failed", refund)));
    expect(mocks.opsAlerts).toHaveBeenCalledTimes(2);
  });

  it("alerts once when a refund can't be delivered", async () => {
    const refund = { id: "re_fail", object: "refund", amount: 25_000, payment_intent: "pi_1", failure_reason: "expired_or_canceled_card" };
    await POST(signedRequest(event("refund.failed", refund)));
    await POST(signedRequest(event("refund.failed", refund)));
    expect(mocks.opsAlerts).toHaveBeenCalledTimes(1);
    expect(mocks.opsAlerts).toHaveBeenCalledWith(expect.objectContaining({ subject: "A refund couldn't be delivered" }));
  });
});
