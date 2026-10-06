import { describe, expect, it } from "vitest";
import { formatPriceIn, isCurrencyCode } from "./currency";

describe("formatPriceIn", () => {
  it("formats GBP identically to the base currency (perGBP: 1)", () => {
    expect(formatPriceIn(7500, "GBP")).toBe("£75");
    expect(formatPriceIn(3570, "GBP")).toBe("£35.70");
  });

  it("converts to USD using the static rate", () => {
    // 75 * 1.27 = 95.25 -> rounds to nearest whole dollar
    expect(formatPriceIn(7500, "USD")).toBe("$95");
  });

  it("converts to EUR using the static rate", () => {
    // 75 * 1.17 = 87.75 -> rounds to nearest whole euro
    expect(formatPriceIn(7500, "EUR")).toBe("€88");
  });

  it("formats zero in any currency", () => {
    expect(formatPriceIn(0, "USD")).toBe("$0");
  });
});

describe("isCurrencyCode", () => {
  it("accepts every supported code", () => {
    expect(isCurrencyCode("GBP")).toBe(true);
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("EUR")).toBe(true);
  });

  it("rejects an unsupported or malformed value", () => {
    expect(isCurrencyCode("JPY")).toBe(false);
    expect(isCurrencyCode("")).toBe(false);
  });
});
