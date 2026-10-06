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
  },
  state: {
    booking: null as null | Record<string, unknown>,
    alerts: new Set<string>(),
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
vi.mock("@/lib/availability", () => ({ isRequestedRangeStillAvailable: async () => true }));
vi.mock("@/lib/stripeConnect", () => ({ refreshConnectAccountStatus: vi.fn() }));
vi.mock("@/lib/listingPromotions", () => ({ activatePaidPromotion: vi.fn() }));
vi.mock("@/lib/listingPromotionNotifications", () => ({ notifyListingPromotionActivated: vi.fn() }));
vi.mock("@/lib/bookingLifecycle", () => ({ releaseUnpaidBooking: vi.fn() }));
vi.mock("@/app/api/bookings/[id]/change-requests/[requestId]/pay/route", () => ({ applyApprovedChange: vi.fn() }));
vi.mock("@/app/api/bookings/[id]/extras/route", () => ({ notifyTripExtraPaid: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { Prisma } = await import("@prisma/client");
  const listing = { title: "Seaside flat", city: "Blackpool", host: { name: "Host", email: "host@example.com" } };
  return {
    prisma: {
      booking: {
        findUnique: async ({ select }: { select?: object }) =>
          state.booking ? (select ? { ...state.booking } : { ...state.booking, listing }) : null,
        findUniqueOrThrow: async () => ({ ...state.booking, listing }),
        findFirst: async () => (state.booking ? { reference: state.booking.reference } : null),
        updateMany: async ({ where, data }: { where: { status: string | { in: string[] } }; data: object }) => {
          const b = state.booking!;
          const ok = typeof where.status === "string" ? b.status === where.status : where.status.in.includes(b.status as string);
          if (!ok) return { count: 0 };
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
    },
  };
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
  state.booking = {
    id: "bk_1",
    reference: "FY-ABC",
    status: "PENDING",
    paymentStatus: "UNPAID",
    totalPriceCents: 50_000,
    creditAppliedCents: 0,
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
