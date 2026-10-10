import { describe, expect, it } from "vitest";
import {
  cancellationStanding,
  computeCancellationRefund,
  daysBeforeCheckIn,
  resolveCancellationPolicy,
  bookingCancellationTerms,
  cancellationTermsSnapshot,
} from "./cancellationPolicy";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe("resolveCancellationPolicy", () => {
  it("resolves the three fixed policies by kind", () => {
    expect(resolveCancellationPolicy({ cancellationPolicy: "FLEXIBLE" }).label).toBe("Flexible");
    expect(resolveCancellationPolicy({ cancellationPolicy: "MODERATE" }).label).toBe("Moderate");
    expect(resolveCancellationPolicy({ cancellationPolicy: "STRICT" }).label).toBe("Strict");
  });

  it("builds a CUSTOM policy from the listing's own cutoff and percentage", () => {
    const policy = resolveCancellationPolicy({
      cancellationPolicy: "CUSTOM",
      customCancellationCutoffDays: 14,
      customCancellationRefundPercent: 75,
    });
    expect(policy.tiers).toEqual([
      { minDaysBeforeCheckIn: 14, refundPercent: 75 },
      { minDaysBeforeCheckIn: 0, refundPercent: 0 },
    ]);
  });

  it("falls back to a sane default for an incompletely configured CUSTOM policy", () => {
    const policy = resolveCancellationPolicy({
      cancellationPolicy: "CUSTOM",
      customCancellationCutoffDays: null,
      customCancellationRefundPercent: null,
    });
    expect(policy.tiers[0]).toEqual({ minDaysBeforeCheckIn: 7, refundPercent: 50 });
  });
});

describe("daysBeforeCheckIn", () => {
  it("counts whole days remaining, and goes negative once check-in has passed", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(daysBeforeCheckIn(new Date("2026-01-06T00:00:00Z"), now)).toBe(5);
    expect(daysBeforeCheckIn(new Date("2025-12-30T00:00:00Z"), now)).toBe(-2);
  });
});

describe("computeCancellationRefund", () => {
  it("refunds nothing when nothing was paid, regardless of policy or timing", () => {
    const policy = resolveCancellationPolicy({ cancellationPolicy: "FLEXIBLE" });
    const refund = computeCancellationRefund({
      policy,
      amountPaidCents: 0,
      checkIn: daysFromNow(30),
    });
    expect(refund).toEqual({ refundPercent: 0, refundCents: 0, nonRefundableCents: 0 });
  });

  it("FLEXIBLE: full refund a week out, nothing once check-in has passed", () => {
    const policy = resolveCancellationPolicy({ cancellationPolicy: "FLEXIBLE" });
    expect(
      computeCancellationRefund({ policy, amountPaidCents: 22000, checkIn: daysFromNow(7) }),
    ).toEqual({ refundPercent: 100, refundCents: 22000, nonRefundableCents: 0 });
    expect(
      computeCancellationRefund({ policy, amountPaidCents: 22000, checkIn: daysFromNow(-1) }),
    ).toEqual({ refundPercent: 0, refundCents: 0, nonRefundableCents: 22000 });
  });

  it("MODERATE: steps down from 100% to 50% to 0% as the cutoffs pass", () => {
    const policy = resolveCancellationPolicy({ cancellationPolicy: "MODERATE" });
    expect(
      computeCancellationRefund({ policy, amountPaidCents: 30000, checkIn: daysFromNow(5) })
        .refundPercent,
    ).toBe(100);
    expect(
      computeCancellationRefund({ policy, amountPaidCents: 30000, checkIn: daysFromNow(3) })
        .refundPercent,
    ).toBe(50);
    expect(
      computeCancellationRefund({ policy, amountPaidCents: 30000, checkIn: daysFromNow(0) })
        .refundPercent,
    ).toBe(0);
  });

  it("STRICT: half back a week out, otherwise nothing", () => {
    const policy = resolveCancellationPolicy({ cancellationPolicy: "STRICT" });
    const refund = computeCancellationRefund({
      policy,
      amountPaidCents: 10000,
      checkIn: daysFromNow(10),
    });
    expect(refund).toEqual({ refundPercent: 50, refundCents: 5000, nonRefundableCents: 5000 });
    expect(
      computeCancellationRefund({ policy, amountPaidCents: 10000, checkIn: daysFromNow(2) })
        .refundCents,
    ).toBe(0);
  });

  it("CUSTOM: applies the host's own cutoff and percentage", () => {
    const policy = resolveCancellationPolicy({
      cancellationPolicy: "CUSTOM",
      customCancellationCutoffDays: 3,
      customCancellationRefundPercent: 90,
    });
    const refund = computeCancellationRefund({
      policy,
      amountPaidCents: 10000,
      checkIn: daysFromNow(3),
    });
    expect(refund).toEqual({ refundPercent: 90, refundCents: 9000, nonRefundableCents: 1000 });
  });

  it("rounds a fractional refund to the nearest whole penny", () => {
    const policy = resolveCancellationPolicy({ cancellationPolicy: "STRICT" });
    // 50% of £1.01 (101p) is 50.5p, rounds to 51p.
    const refund = computeCancellationRefund({ policy, amountPaidCents: 101, checkIn: daysFromNow(10) });
    expect(refund.refundCents).toBe(51);
    expect(refund.nonRefundableCents).toBe(50);
  });
});

describe("cancellationStanding", () => {
  const moderate = resolveCancellationPolicy({ cancellationPolicy: "MODERATE" });
  const checkIn = new Date("2026-12-06T00:00:00Z");
  const at = (iso: string) => new Date(iso);

  it("gives the full-refund deadline while it still applies, up to and including that day", () => {
    expect(cancellationStanding(moderate, checkIn, at("2026-11-20T12:00:00Z"))).toEqual({
      refundPercent: 100,
      until: new Date("2026-12-01T00:00:00Z"),
    });
    expect(cancellationStanding(moderate, checkIn, at("2026-12-01T20:00:00Z")).refundPercent).toBe(100);
  });

  it("moves to the next tier's deadline after that", () => {
    expect(cancellationStanding(moderate, checkIn, at("2026-12-03T09:00:00Z"))).toEqual({
      refundPercent: 50,
      until: new Date("2026-12-05T00:00:00Z"),
    });
  });

  it("has no deadline once nothing is refundable", () => {
    expect(cancellationStanding(moderate, checkIn, at("2026-12-06T09:00:00Z"))).toEqual({ refundPercent: 0, until: null });
  });

  it("agrees with what a cancellation would actually refund", () => {
    for (const now of ["2026-11-01T10:00:00Z", "2026-12-02T10:00:00Z", "2026-12-05T23:00:00Z", "2026-12-07T10:00:00Z"]) {
      const standing = cancellationStanding(moderate, checkIn, at(now));
      const refund = computeCancellationRefund({ policy: moderate, amountPaidCents: 10000, checkIn, now: at(now) });
      expect(refund.refundPercent).toBe(standing.refundPercent);
    }
  });
});

describe("bookingCancellationTerms", () => {
  const strictNow = { cancellationPolicy: "CUSTOM" as const, customCancellationCutoffDays: 90, customCancellationRefundPercent: 0 };

  it("keeps the terms the guest booked under when the host changes their policy later", () => {
    const booked = cancellationTermsSnapshot({ cancellationPolicy: "FLEXIBLE", customCancellationCutoffDays: 14, customCancellationRefundPercent: 80 });
    expect(booked).toEqual({ cancellationPolicy: "FLEXIBLE", customCancellationCutoffDays: null, customCancellationRefundPercent: null });
    expect(bookingCancellationTerms({ ...booked, listing: strictNow }).cancellationPolicy).toBe("FLEXIBLE");
  });

  it("keeps a custom policy's own numbers", () => {
    const booked = cancellationTermsSnapshot({ cancellationPolicy: "CUSTOM", customCancellationCutoffDays: 5, customCancellationRefundPercent: 75 });
    expect(bookingCancellationTerms({ ...booked, listing: strictNow })).toEqual({
      cancellationPolicy: "CUSTOM",
      customCancellationCutoffDays: 5,
      customCancellationRefundPercent: 75,
    });
  });

  it("falls back to the listing for bookings made before terms were recorded", () => {
    expect(bookingCancellationTerms({ cancellationPolicy: null, listing: strictNow })).toBe(strictNow);
  });
});

describe("Non-refundable with a 24-hour window after payment", () => {
  const policy = resolveCancellationPolicy({ cancellationPolicy: "NON_REFUNDABLE" });
  const checkIn = new Date("2026-11-20T00:00:00Z");
  const paidAt = new Date("2026-11-01T10:00:00Z");
  const refundAt = (now: Date, paid: Date | null = paidAt, at = checkIn) =>
    computeCancellationRefund({ policy, amountPaidCents: 59_400, checkIn: at, now, paidAt: paid });

  it("refunds in full within 24 hours of paying", () => {
    expect(refundAt(new Date("2026-11-02T09:59:00Z"))).toEqual({ refundPercent: 100, refundCents: 59_400, nonRefundableCents: 0 });
  });

  it("refunds nothing once 24 hours have passed, however far off check-in is", () => {
    expect(refundAt(new Date("2026-11-02T10:00:00Z")).refundCents).toBe(0);
    expect(refundAt(new Date("2026-11-10T10:00:00Z")).refundCents).toBe(0);
  });

  it("refunds nothing without a payment time (and nothing unpaid at all)", () => {
    expect(refundAt(new Date("2026-11-01T11:00:00Z"), null).refundCents).toBe(0);
    expect(computeCancellationRefund({ policy, amountPaidCents: 0, checkIn, paidAt, now: new Date("2026-11-01T11:00:00Z") }).refundCents).toBe(0);
  });

  it("closes the window at the start of the check-in date", () => {
    const lateBooking = new Date("2026-11-19T18:00:00Z");
    expect(refundAt(new Date("2026-11-19T23:00:00Z"), lateBooking).refundPercent).toBe(100);
    expect(refundAt(new Date("2026-11-20T08:00:00Z"), lateBooking).refundPercent).toBe(0);
    // Paid on the check-in date itself: no window at all.
    expect(refundAt(new Date("2026-11-20T10:00:00Z"), new Date("2026-11-20T09:00:00Z")).refundPercent).toBe(0);
  });

  it("shows the deadline as a moment, and nothing after it", () => {
    expect(cancellationStanding(policy, checkIn, new Date("2026-11-01T12:00:00Z"), paidAt)).toEqual({
      refundPercent: 100,
      until: new Date("2026-11-02T10:00:00Z"),
      untilIsTime: true,
    });
    expect(cancellationStanding(policy, checkIn, new Date("2026-11-03T12:00:00Z"), paidAt)).toEqual({ refundPercent: 0, until: null });
  });

  it("doesn't give other policies the window", () => {
    const strict = resolveCancellationPolicy({ cancellationPolicy: "STRICT" });
    expect(computeCancellationRefund({ policy: strict, amountPaidCents: 10_000, checkIn, paidAt, now: new Date("2026-11-15T10:30:00Z") }).refundPercent).toBe(0);
  });

  it("is snapshotted onto bookings like every other policy", () => {
    expect(cancellationTermsSnapshot({ cancellationPolicy: "NON_REFUNDABLE" })).toEqual({
      cancellationPolicy: "NON_REFUNDABLE",
      customCancellationCutoffDays: null,
      customCancellationRefundPercent: null,
    });
  });
});
