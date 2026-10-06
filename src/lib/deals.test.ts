import { describe, expect, it } from "vitest";
import { computeBookingPricing } from "./pricing";
import {
  dealNightlyPriceCents,
  activePriceDrop,
  daysUntilStay,
  lastMinuteDiscountFor,
  listingDeal,
  priceChangeFields,
} from "./deals";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-05T12:00:00Z");
const stayDate = (daysFromToday: number) => new Date(Date.UTC(2026, 9, 5 + daysFromToday));
const ago = (days: number) => new Date(now.getTime() - days * DAY);

describe("last-minute deals", () => {
  const listing = { lastMinuteDiscountPercent: 20, lastMinuteWindowDays: 7 };

  it("counts whole calendar days to check-in", () => {
    expect(daysUntilStay(stayDate(0), now)).toBe(0);
    expect(daysUntilStay(stayDate(7), now)).toBe(7);
    expect(daysUntilStay(stayDate(-1), now)).toBe(-1);
  });

  it("applies from today through the last day of the window, and not after", () => {
    expect(lastMinuteDiscountFor(listing, stayDate(0), now)).toBe(20);
    expect(lastMinuteDiscountFor(listing, stayDate(7), now)).toBe(20);
    expect(lastMinuteDiscountFor(listing, stayDate(8), now)).toBeNull();
    expect(lastMinuteDiscountFor(listing, stayDate(-1), now)).toBeNull();
  });

  it("needs both a percentage and a window", () => {
    expect(lastMinuteDiscountFor({ lastMinuteDiscountPercent: 20, lastMinuteWindowDays: null }, stayDate(1), now)).toBeNull();
    expect(lastMinuteDiscountFor({ lastMinuteDiscountPercent: null, lastMinuteWindowDays: 7 }, stayDate(1), now)).toBeNull();
  });
});

describe("activePriceDrop", () => {
  it("shows the earlier price for 28 days after a drop", () => {
    const listing = { pricePerNightCents: 8000, priceDropFromCents: 10000, priceDroppedAt: ago(10) };
    expect(activePriceDrop(listing, now)).toEqual({ fromCents: 10000, percentOff: 20 });
    expect(activePriceDrop({ ...listing, priceDroppedAt: ago(29) }, now)).toBeNull();
  });

  it("is gone once the price is back at or above the earlier price", () => {
    expect(activePriceDrop({ pricePerNightCents: 10000, priceDropFromCents: 10000, priceDroppedAt: ago(1) }, now)).toBeNull();
  });
});

describe("priceChangeFields", () => {
  const base = { pricePerNightCents: 10000, priceDropFromCents: null, priceDroppedAt: null, createdAt: ago(200) };

  it("records a drop when the old price had been charged for 28+ days", () => {
    expect(priceChangeFields({ ...base, priceChangedAt: ago(30) }, 8000, now)).toEqual({
      priceDropFromCents: 10000,
      priceDroppedAt: now,
      priceChangedAt: now,
    });
  });

  it("records no drop for a price that was only just set - so a 'was' price can't be manufactured", () => {
    expect(priceChangeFields({ ...base, priceChangedAt: ago(3) }, 8000, now)).toEqual({
      priceDropFromCents: null,
      priceDroppedAt: null,
      priceChangedAt: now,
    });
  });

  it("keeps the original 'was' price through a further cut", () => {
    const dropped = { ...base, pricePerNightCents: 8000, priceDropFromCents: 10000, priceDroppedAt: ago(5), priceChangedAt: ago(5) };
    expect(priceChangeFields(dropped, 7000, now)).toEqual({ priceChangedAt: now });
  });

  it("ends the drop when the price goes back up to the 'was' price", () => {
    const dropped = { ...base, pricePerNightCents: 8000, priceDropFromCents: 10000, priceDroppedAt: ago(5), priceChangedAt: ago(5) };
    expect(priceChangeFields(dropped, 10000, now)).toEqual({
      priceDropFromCents: null,
      priceDroppedAt: null,
      priceChangedAt: now,
    });
  });

  it("uses the listing's creation date when the price has never changed, and does nothing for the same price", () => {
    expect(priceChangeFields({ ...base, priceChangedAt: null }, 9000, now)).toMatchObject({ priceDropFromCents: 10000 });
    expect(priceChangeFields({ ...base, priceChangedAt: null }, 10000, now)).toEqual({});
  });
});

describe("listingDeal", () => {
  const none = { lastMinuteDiscountPercent: null, lastMinuteWindowDays: null, pricePerNightCents: 8000, priceDropFromCents: null, priceDroppedAt: null };

  it("reports whichever deal saves more", () => {
    const both = { ...none, lastMinuteDiscountPercent: 15, lastMinuteWindowDays: 7, priceDropFromCents: 10000, priceDroppedAt: ago(1) };
    expect(listingDeal(both, now)).toEqual({ kind: "price_drop", percentOff: 20, fromCents: 10000 });
    expect(listingDeal({ ...both, lastMinuteDiscountPercent: 30 }, now)).toEqual({ kind: "last_minute", percentOff: 30, windowDays: 7 });
  });

  it("is null for a listing with no deal", () => {
    expect(listingDeal(none, now)).toBeNull();
  });
});

describe("dealNightlyPriceCents", () => {
  it("shows pence when the deal lands on them, and whole pounds when it doesn't", () => {
    expect(dealNightlyPriceCents(4200, 15)).toBe(3570); // £42 at 15% off = £35.70
    expect(dealNightlyPriceCents(5000, 10)).toBe(4500); // £50 at 10% off = £45
  });

  it("matches what checkout charges for one night, for every price and deal size", () => {
    for (let price = 1000; price <= 60000; price += 137) {
      for (let percent = 5; percent <= 50; percent++) {
        const checkout = computeBookingPricing({ nights: 1, pricePerNightCents: price, lastMinuteDiscountPercent: percent });
        expect(dealNightlyPriceCents(price, percent)).toBe(
          checkout.nightlySubtotalCents - checkout.lengthOfStayDiscountCents,
        );
      }
    }
  });
});
