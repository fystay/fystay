import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: {
    extra: {} as Record<string, unknown>,
    bookingStatus: "CONFIRMED",
    // Runs right after the extra is first read: a cancellation landing
    // between that read and the claim.
    afterRead: null as null | (() => void),
  },
  mocks: { providerEmail: vi.fn() },
}));

vi.mock("@/lib/notificationEmails", () => ({
  sendTripExtraProviderEmail: (...a: unknown[]) => mocks.providerEmail(...a),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bookingExtra: {
      findUniqueOrThrow: async () => {
        const read = {
          ...state.extra,
          offering: {
            name: "Airport transfer",
            category: "TRANSFER",
            provider: {
              name: "EV Exec",
              notificationEmail: "jobs@example.com",
              bookingFormUrl: null,
              integration: "email",
            },
          },
          booking: {
            status: state.bookingStatus,
            guestName: "Guest",
            guestEmail: "guest@example.com",
            checkIn: new Date("2026-11-01"),
            checkOut: new Date("2026-11-03"),
            listing: { title: "Flat" },
          },
        };
        state.afterRead?.();
        return read;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        // The claim's own booking-status condition, checked against the
        // booking as it is at the moment of the write.
        const bookingWhere = where.booking as { status: { in: string[] } } | undefined;
        if (bookingWhere && !bookingWhere.status.in.includes(state.bookingStatus)) return { count: 0 };
        if (state.extra.status !== where.status) return { count: 0 };
        Object.assign(state.extra, {
          fulfillmentStatus: data.fulfillmentStatus,
        });
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.extra, data),
    },
  },
}));

import { fulfillBookingExtra } from "./tripExtraFulfillment";

beforeEach(() => {
  mocks.providerEmail.mockReset().mockResolvedValue(true);
  state.bookingStatus = "CONFIRMED";
  state.afterRead = null;
  state.extra = {
    id: "ex_1",
    bookingId: "bk_1",
    status: "PAID",
    priceCents: 4_000,
    guestNotes: null,
    fulfillmentStatus: "PENDING",
    sentToProviderAt: null,
  };
});

describe("fulfillBookingExtra", () => {
  it("hands a paid extra on a confirmed stay to its provider", async () => {
    expect(await fulfillBookingExtra("ex_1")).toEqual({
      kind: "done",
      status: "SENT",
    });
    expect(mocks.providerEmail).toHaveBeenCalledTimes(1);
  });

  it("never hands over an extra whose booking was cancelled", async () => {
    state.bookingStatus = "CANCELLED";
    expect(await fulfillBookingExtra("ex_1", { retry: true })).toEqual({
      kind: "skipped",
      reason: "booking_not_active",
    });
    expect(mocks.providerEmail).not.toHaveBeenCalled();
    expect(state.extra.fulfillmentStatus).toBe("PENDING");
  });

  it("doesn't claim it when the booking is cancelled between the read and the claim", async () => {
    // Read as CONFIRMED, cancelled before the conditional claim runs.
    state.afterRead = () => {
      state.bookingStatus = "CANCELLED";
    };
    expect(await fulfillBookingExtra("ex_1")).toEqual({
      kind: "skipped",
      reason: "not_claimable",
    });
    expect(mocks.providerEmail).not.toHaveBeenCalled();
  });
});
