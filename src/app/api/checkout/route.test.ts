import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { bookingFindUnique, bookingUpdate, sendConfirmed } = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  bookingUpdate: vi.fn(),
  sendConfirmed: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "guest_1" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { booking: { findUnique: bookingFindUnique, update: bookingUpdate } },
}));
vi.mock("@/lib/availability", () => ({
  isBookingHoldActive: () => true,
  isRequestedRangeStillAvailable: async () => true,
}));
vi.mock("@/lib/notificationEmails", () => ({ sendBookingConfirmedEmails: sendConfirmed }));
vi.mock("@/lib/referral", () => ({ awardReferralBonusIfEligible: async () => {} }));

import { POST } from "./route";
import { PAYMENTS_UNAVAILABLE_MESSAGE } from "@/lib/stripe";

const pendingBooking = {
  id: "bk_1",
  guestId: "guest_1",
  listingId: "listing_1",
  status: "PENDING",
  approvalStatus: null,
  reference: "FY-1",
  listing: { title: "Sea view flat", city: "Blackpool", host: { name: "Host", email: "host@example.com" } },
};

function checkout() {
  return POST(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookingId: "bk_1" }),
    }),
  );
}

beforeEach(() => {
  bookingFindUnique.mockReset().mockResolvedValue(pendingBooking);
  bookingUpdate.mockReset().mockResolvedValue(pendingBooking);
  sendConfirmed.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function production(company: { name?: string; address?: string }) {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc");
  vi.stubEnv("NEXT_PUBLIC_COMPANY_LEGAL_NAME", company.name ?? "");
  vi.stubEnv("NEXT_PUBLIC_COMPANY_ADDRESS", company.address ?? "");
}

describe("POST /api/checkout on Production without the trader's identity", () => {
  for (const [missing, company] of [
    ["legal name", { address: "1 High Street, Blackpool FY1 1AA" }],
    ["address", { name: "FYStay Ltd" }],
  ] as const) {
    it(`refuses a live payment without the ${missing} and leaves the booking unconfirmed`, async () => {
      production(company);
      const res = await checkout();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: PAYMENTS_UNAVAILABLE_MESSAGE });
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(sendConfirmed).not.toHaveBeenCalled();
    });
  }
});

describe("POST /api/checkout off Production", () => {
  it("still confirms without Stripe or a trader identity, as local and Preview always have", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_COMPANY_LEGAL_NAME", "");
    vi.stubEnv("NEXT_PUBLIC_COMPANY_ADDRESS", "");
    const res = await checkout();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ devMode: true });
    expect(bookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CONFIRMED" }) }),
    );
  });
});
