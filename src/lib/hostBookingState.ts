import type { PillTone } from "@/components/host/HostUi";

export type HostBookingTab = "action" | "upcoming" | "current" | "past" | "cancelled";

export type HostBookingStateInput = {
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "REFUNDED";
  approvalStatus: "NONE" | "AWAITING" | "APPROVED" | "DECLINED" | "EXPIRED";
  paymentStatus: "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
  checkIn: Date;
  checkOut: Date;
  depositStatus?: string;
};

export type HostBookingState = { label: string; tone: PillTone; tab: HostBookingTab };

/**
 * One booking's state in a host's words - "Arriving today", "Staying",
 * "Needs your reply" - and the Bookings tab it lives under. The stored
 * status alone can't say this: COMPLETED is only written lazily (see
 * completePastBookings), so a CONFIRMED stay whose check-out has passed is
 * shown as completed here too.
 */
export function hostBookingState(
  b: HostBookingStateInput,
  today: Date,
  opts: { hasPendingChange?: boolean; now?: Date } = {},
): HostBookingState {
  const now = opts.now ?? today;
  if (b.status === "CANCELLED" || b.status === "REFUNDED") {
    return {
      label: b.paymentStatus === "PARTIALLY_REFUNDED" ? "Cancelled · part refunded" : "Cancelled",
      tone: "neutral",
      tab: "cancelled",
    };
  }
  if (b.approvalStatus === "AWAITING" && b.status === "PENDING") {
    return { label: "Needs your reply", tone: "danger", tab: "action" };
  }
  if (b.status === "PENDING") {
    return { label: "Awaiting payment", tone: "warning", tab: "upcoming" };
  }
  if (opts.hasPendingChange) {
    return { label: "Change requested", tone: "warning", tab: "action" };
  }
  if (b.depositStatus === "AUTHORIZED" && b.checkOut <= now) {
    return { label: "Settle deposit", tone: "warning", tab: "action" };
  }
  const day = today.getTime();
  if (b.checkIn.getTime() === day) return { label: "Arriving today", tone: "success", tab: "current" };
  if (b.checkOut.getTime() === day) return { label: "Leaving today", tone: "info", tab: "current" };
  if (b.checkIn.getTime() < day && b.checkOut.getTime() > day) return { label: "Staying now", tone: "success", tab: "current" };
  if (b.checkOut.getTime() < day) return { label: "Completed", tone: "neutral", tab: "past" };
  return { label: "Confirmed", tone: "brand", tab: "upcoming" };
}
