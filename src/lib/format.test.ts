import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatPrice, formatStayDate } from "./format";

describe("formatPrice", () => {
  it("formats whole pounds with no decimal places", () => {
    expect(formatPrice(7500)).toBe("£75");
  });

  it("shows pence in full when there are any, so it's exactly what's charged", () => {
    expect(formatPrice(7550)).toBe("£75.50");
    expect(formatPrice(3570)).toBe("£35.70");
    expect(formatPrice(5805)).toBe("£58.05");
  });

  it("formats zero", () => {
    expect(formatPrice(0)).toBe("£0");
  });

  it("formats large amounts with thousands separators", () => {
    expect(formatPrice(123456700)).toBe("£1,234,567");
  });
});

describe("date formatting", () => {
  it("formats a stay date unambiguously, independent of the runtime timezone", () => {
    expect(formatStayDate(new Date("2026-10-01T00:00:00Z"))).toBe("1 Oct 2026");
    expect(formatStayDate("2026-12-31T00:00:00.000Z")).toBe("31 Dec 2026");
  });

  it("formats moments in UK time", () => {
    // 23:30 UTC in summer is already the next day in London (BST).
    expect(formatDate(new Date("2026-07-01T23:30:00Z"))).toBe("2 Jul 2026");
    expect(formatDateTime(new Date("2026-01-15T09:05:00Z"))).toBe("15 Jan 2026, 09:05");
  });
});
