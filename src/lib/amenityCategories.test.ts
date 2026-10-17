import { describe, expect, it } from "vitest";
import {
  AMENITY_CATEGORIES,
  FILTER_AMENITIES,
  availableAmenityCategories,
  matchesAmenityCategories,
} from "./amenityCategories";

describe("AMENITY_CATEGORIES", () => {
  it("matches real freeform amenity text, not just an exact canonical label", () => {
    const wifi = AMENITY_CATEGORIES.find((c) => c.key === "wifi")!;
    expect(wifi.test(["Wifi", "Kitchen"])).toBe(true);
    expect(wifi.test(["Wi-Fi"])).toBe(true);
    expect(wifi.test(["Kitchen"])).toBe(false);

    const parking = AMENITY_CATEGORIES.find((c) => c.key === "parking")!;
    expect(parking.test(["Free parking"])).toBe(true);
    expect(parking.test(["Off-street parking"])).toBe(true);
    expect(parking.test(["Kitchen"])).toBe(false);

    const petFriendly = AMENITY_CATEGORIES.find((c) => c.key === "pet_friendly")!;
    expect(petFriendly.test(["Pet friendly"])).toBe(true);
    expect(petFriendly.test(["Kitchen"])).toBe(false);

    const seaView = AMENITY_CATEGORIES.find((c) => c.key === "sea_view")!;
    expect(seaView.test(["Sea view"])).toBe(true);
    expect(seaView.test(["Ocean view"])).toBe(true);
    expect(seaView.test(["Garden"])).toBe(false);
  });

  it("treats each accessibility feature as its own filter, not one blanket toggle", () => {
    const stepFree = AMENITY_CATEGORIES.find((c) => c.key === "step_free_entrance")!;
    expect(stepFree.test(["Step-free entrance"])).toBe(true);
    expect(stepFree.test(["Wide doorways"])).toBe(false);

    const bathroom = AMENITY_CATEGORIES.find((c) => c.key === "accessible_bathroom")!;
    expect(bathroom.test(["Accessible bathroom"])).toBe(true);
    expect(bathroom.test(["Roll-in shower available"])).toBe(true);
    expect(bathroom.test(["Step-free entrance"])).toBe(false);

    const parking = AMENITY_CATEGORIES.find((c) => c.key === "accessible_parking")!;
    expect(parking.test(["Accessible parking"])).toBe(true);
    // A listing tagged only with the general parking amenity hasn't
    // actually confirmed the accessible-parking feature specifically.
    expect(parking.test(["Free parking"])).toBe(false);
  });
});

describe("matchesAmenityCategories", () => {
  it("matches everything when no categories are selected", () => {
    expect(matchesAmenityCategories([], [])).toBe(true);
  });

  it("requires every selected category to match (AND, not OR)", () => {
    const amenities = ["Wifi", "Free parking"];
    expect(matchesAmenityCategories(amenities, ["wifi", "parking"])).toBe(true);
    expect(matchesAmenityCategories(amenities, ["wifi", "kitchen"])).toBe(false);
  });

  it("ignores an unrecognized category key rather than rejecting everything", () => {
    expect(matchesAmenityCategories(["Wifi"], ["wifi", "not-a-real-category"])).toBe(true);
  });
});

describe("availableAmenityCategories", () => {
  it("only returns categories actually backed by at least one listing", () => {
    const listings = [{ amenities: ["Wifi", "Kitchen"] }, { amenities: ["Free parking"] }];
    const available = availableAmenityCategories(listings).map((c) => c.key);
    expect(available).toEqual(expect.arrayContaining(["wifi", "kitchen", "parking"]));
    expect(available).not.toContain("pet_friendly");
    expect(available).not.toContain("step_free_entrance");
  });

  it("returns nothing when no listings are given", () => {
    expect(availableAmenityCategories([])).toEqual([]);
  });
});

describe("the Filters panel's core amenities", () => {
  const test = (key: string, amenities: string[]) => matchesAmenityCategories(amenities, [key]);

  it("offers six, each backed by a real category", () => {
    expect(FILTER_AMENITIES.map((a) => a.label)).toEqual(["Free WiFi", "Free parking", "Kitchen", "Pet-friendly", "Washer", "Air conditioning"]);
    for (const { key } of FILTER_AMENITIES) {
      expect(AMENITY_CATEGORIES.some((c) => c.key === key)).toBe(true);
    }
  });

  it("matches the ways hosts actually write them", () => {
    expect(test("wifi", ["WiFi"])).toBe(true);
    expect(test("wifi", ["Free wi-fi throughout"])).toBe(true);
    expect(test("parking", ["Parking"])).toBe(true);
    expect(test("parking", ["On-street parking"])).toBe(true);
    expect(test("washer", ["Washer"])).toBe(true);
    expect(test("washer", ["Washing machine"])).toBe(true);
    expect(test("washer", ["Laundry room"])).toBe(true);
    expect(test("air_conditioning", ["Air con"])).toBe(true);
    expect(test("pet_friendly", ["Dogs welcome"])).toBe(true);
  });

  it("leaves out what doesn't qualify", () => {
    expect(test("wifi", ["Paid wifi (£5/day)"])).toBe(false);
    expect(test("parking", ["Paid parking nearby"])).toBe(false);
    expect(test("washer", ["Dishwasher"])).toBe(false);
    expect(test("pet_friendly", ["No pets"])).toBe(false);
    expect(test("pet_friendly", ["Carpets throughout"])).toBe(false);
  });
});
