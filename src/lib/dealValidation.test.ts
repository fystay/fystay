import { describe, expect, it } from "vitest";
import { resolveLastMinuteDeal } from "./dealValidation";

const noDeal = { lastMinuteDiscountPercent: null, lastMinuteWindowDays: null };
const deal = { lastMinuteDiscountPercent: 20, lastMinuteWindowDays: 7 };

describe("resolveLastMinuteDeal", () => {
  it("leaves the deal alone when neither field is sent", () => {
    expect(resolveLastMinuteDeal({}, deal)).toEqual({ fields: {} });
  });

  it("removes the whole deal when the percentage is cleared", () => {
    expect(resolveLastMinuteDeal({ lastMinuteDiscountPercent: null }, deal)).toEqual({
      fields: { lastMinuteDiscountPercent: null, lastMinuteWindowDays: null },
    });
  });

  it("keeps the saved window when only the percentage changes", () => {
    expect(resolveLastMinuteDeal({ lastMinuteDiscountPercent: 25 }, deal)).toEqual({
      fields: { lastMinuteDiscountPercent: 25, lastMinuteWindowDays: 7 },
    });
  });

  it("refuses a new deal with no window", () => {
    expect(resolveLastMinuteDeal({ lastMinuteDiscountPercent: 25 }, noDeal)).toHaveProperty("error");
    expect(resolveLastMinuteDeal({ lastMinuteDiscountPercent: 25, lastMinuteWindowDays: null })).toHaveProperty("error");
  });

  it("never saves a window without a percentage", () => {
    expect(resolveLastMinuteDeal({ lastMinuteWindowDays: 3 }, noDeal)).toEqual({ fields: { lastMinuteWindowDays: null } });
  });
});
