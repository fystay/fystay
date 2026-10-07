import { describe, expect, it } from "vitest";
import { hostBookingState, type HostBookingStateInput } from "./hostBookingState";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d("2026-10-15");
const b = (over: Partial<HostBookingStateInput>): HostBookingStateInput => ({
  status: "CONFIRMED",
  approvalStatus: "NONE",
  paymentStatus: "PAID",
  checkIn: d("2026-10-20"),
  checkOut: d("2026-10-23"),
  ...over,
});

describe("hostBookingState", () => {
  it.each([
    [b({}), "Confirmed", "upcoming"],
    [b({ checkIn: today }), "Arriving today", "current"],
    [b({ checkIn: d("2026-10-12"), checkOut: today }), "Leaving today", "current"],
    [b({ checkIn: d("2026-10-13"), checkOut: d("2026-10-17") }), "Staying now", "current"],
    // Still CONFIRMED in the database (completion is lazy) but over.
    [b({ checkIn: d("2026-10-01"), checkOut: d("2026-10-04") }), "Completed", "past"],
    [b({ status: "COMPLETED", checkIn: d("2026-10-01"), checkOut: d("2026-10-04") }), "Completed", "past"],
    [b({ status: "PENDING", approvalStatus: "AWAITING", paymentStatus: "UNPAID" }), "Needs your reply", "action"],
    [b({ status: "PENDING", paymentStatus: "UNPAID" }), "Awaiting payment", "upcoming"],
    [b({ status: "CANCELLED", paymentStatus: "PARTIALLY_REFUNDED" }), "Cancelled · part refunded", "cancelled"],
    [b({ status: "CANCELLED", paymentStatus: "REFUNDED" }), "Cancelled", "cancelled"],
  ])("%#: %s", (input, label, tab) => {
    expect(hostBookingState(input, today)).toMatchObject({ label, tab });
  });

  it("puts a pending date change and a deposit to settle under Needs action", () => {
    expect(hostBookingState(b({}), today, { hasPendingChange: true })).toMatchObject({ tab: "action" });
    expect(
      hostBookingState(b({ checkIn: d("2026-10-10"), checkOut: d("2026-10-13"), depositStatus: "AUTHORIZED" }), today),
    ).toMatchObject({ label: "Settle deposit", tab: "action" });
  });
});
