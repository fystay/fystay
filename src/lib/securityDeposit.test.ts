import { describe, expect, it } from "vitest";
import {
  DEPOSIT_AUTHORIZATION_WINDOW_DAYS,
  DEPOSIT_CLAIM_WINDOW_DAYS,
  depositClaimDeadline,
  isDepositClaimExpired,
  needsDepositAuthorization,
} from "./securityDeposit";

const d = (s: string) => new Date(s);

describe("needsDepositAuthorization", () => {
  const base = {
    status: "CONFIRMED",
    depositStatus: "AWAITING_AUTHORIZATION",
    checkIn: d("2026-06-10T00:00:00Z"),
    checkOut: d("2026-06-12T00:00:00Z"),
  };

  it("is false well before the authorization window opens", () => {
    expect(needsDepositAuthorization(base, d("2026-06-01T00:00:00Z"))).toBe(false);
  });

  it("is true right at the start of the authorization window", () => {
    const windowStart = new Date(
      base.checkIn.getTime() - DEPOSIT_AUTHORIZATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(needsDepositAuthorization(base, windowStart)).toBe(true);
  });

  it("is true right up to check-out", () => {
    expect(needsDepositAuthorization(base, d("2026-06-11T23:00:00Z"))).toBe(true);
  });

  it("is false once check-out has passed - too late to bother authorizing", () => {
    expect(needsDepositAuthorization(base, d("2026-06-13T00:00:00Z"))).toBe(false);
  });

  it("is false when the booking isn't CONFIRMED", () => {
    expect(needsDepositAuthorization({ ...base, status: "PENDING" }, base.checkIn)).toBe(false);
  });

  it("is false when the deposit isn't awaiting authorization", () => {
    expect(
      needsDepositAuthorization({ ...base, depositStatus: "AUTHORIZED" }, base.checkIn),
    ).toBe(false);
    expect(
      needsDepositAuthorization({ ...base, depositStatus: "NOT_REQUIRED" }, base.checkIn),
    ).toBe(false);
  });
});

describe("depositClaimDeadline", () => {
  it("is DEPOSIT_CLAIM_WINDOW_DAYS after checkout when the hold lasts that long", () => {
    const checkOut = d("2026-06-12T00:00:00Z");
    expect(depositClaimDeadline(checkOut, d("2026-06-10T08:00:00Z")).toISOString()).toBe(
      new Date(checkOut.getTime() + DEPOSIT_CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it("never outlives a standard 7-day hold (less a 12-hour margin)", () => {
    // Hold placed the day before a 5-night stay: it lapses before checkout + 3 days.
    expect(depositClaimDeadline(d("2026-06-15T00:00:00Z"), d("2026-06-09T08:00:00Z")).toISOString()).toBe(
      "2026-06-15T20:00:00.000Z",
    );
  });

  it("follows Stripe's capture_before when it's known, including an extended hold", () => {
    const checkOut = d("2026-06-20T00:00:00Z");
    expect(
      depositClaimDeadline(checkOut, d("2026-06-09T08:00:00Z"), d("2026-07-09T08:00:00Z")).toISOString(),
    ).toBe("2026-06-23T00:00:00.000Z");
    expect(
      depositClaimDeadline(checkOut, d("2026-06-09T08:00:00Z"), d("2026-06-16T08:00:00Z")).toISOString(),
    ).toBe("2026-06-15T20:00:00.000Z");
  });
});

describe("isDepositClaimExpired", () => {
  it("is false before the deadline", () => {
    expect(
      isDepositClaimExpired(
        { depositStatus: "AUTHORIZED", depositClaimDeadline: d("2026-06-15T00:00:00Z") },
        d("2026-06-14T00:00:00Z"),
      ),
    ).toBe(false);
  });

  it("is true once the deadline has passed", () => {
    expect(
      isDepositClaimExpired(
        { depositStatus: "AUTHORIZED", depositClaimDeadline: d("2026-06-15T00:00:00Z") },
        d("2026-06-16T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("is true exactly at the deadline", () => {
    const deadline = d("2026-06-15T00:00:00Z");
    expect(isDepositClaimExpired({ depositStatus: "AUTHORIZED", depositClaimDeadline: deadline }, deadline)).toBe(
      true,
    );
  });

  it("is false when the deposit isn't AUTHORIZED, regardless of the deadline", () => {
    expect(
      isDepositClaimExpired(
        { depositStatus: "CAPTURED", depositClaimDeadline: d("2026-06-01T00:00:00Z") },
        d("2026-06-16T00:00:00Z"),
      ),
    ).toBe(false);
  });

  it("is false when there's no deadline set", () => {
    expect(
      isDepositClaimExpired({ depositStatus: "AUTHORIZED", depositClaimDeadline: null }, d("2026-06-16T00:00:00Z")),
    ).toBe(false);
  });
});
