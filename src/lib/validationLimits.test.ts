import { describe, expect, it } from "vitest";
import { isPlausiblePhone, listingFieldSchemas } from "./validation";

describe("isPlausiblePhone", () => {
  it("accepts numbers written the usual ways", () => {
    for (const n of ["07700 900123", "+44 7700 900123", "(01253) 123-456", "+1 415.555.0100"]) {
      expect(isPlausiblePhone(n)).toBe(true);
    }
  });
  it("rejects text, too few digits and too many", () => {
    for (const n of ["abc", "12345", "call me", "0770090012345678", "07700 9001x3"]) {
      expect(isPlausiblePhone(n)).toBe(false);
    }
  });
});

describe("listingFieldSchemas", () => {
  it("refuses a price beyond £10,000 a night with a message that names the field", () => {
    const result = listingFieldSchemas.pricePerNightCents.safeParse(9_999_999_900);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Price per night can't be more than £10,000");
  });
  it("names the field when a title is too short", () => {
    expect(listingFieldSchemas.title.safeParse("ab").error?.issues[0].message).toBe("Title must be at least 3 characters");
  });
});
