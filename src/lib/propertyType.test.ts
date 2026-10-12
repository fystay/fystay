import { describe, expect, it } from "vitest";
import { FILTER_PROPERTY_TYPES, PROPERTY_TYPE_LABEL, matchesPropertyType } from "./propertyType";

describe("FILTER_PROPERTY_TYPES", () => {
  it("offers the five guest-facing types in order", () => {
    expect(FILTER_PROPERTY_TYPES.map((t) => PROPERTY_TYPE_LABEL[t])).toEqual(["Apartment", "B&B", "Lodge", "House", "Studio"]);
  });
});

describe("matchesPropertyType", () => {
  it("matches the stored type", () => {
    expect(matchesPropertyType({ propertyType: "LODGE", title: "Pine view" }, "LODGE")).toBe(true);
    expect(matchesPropertyType({ propertyType: "HOUSE", title: "Pine view" }, "LODGE")).toBe(false);
  });

  it("finds a B&B or lodge listed before those types existed, by its title", () => {
    expect(matchesPropertyType({ propertyType: "OTHER", title: "Seaview B&B, Blackpool" }, "BED_AND_BREAKFAST")).toBe(true);
    expect(matchesPropertyType({ propertyType: "HOTEL", title: "The Bed and Breakfast on Lord St" }, "BED_AND_BREAKFAST")).toBe(true);
    expect(matchesPropertyType({ propertyType: "COTTAGE", title: "Lakeside Lodge" }, "LODGE")).toBe(true);
  });

  it("reads an unclassified (OTHER) listing's title for the other types, but never relabels a classified one", () => {
    expect(matchesPropertyType({ propertyType: "OTHER", title: "Studio near the tower" }, "STUDIO")).toBe(true);
    expect(matchesPropertyType({ propertyType: "OTHER", title: "Top-floor flat" }, "APARTMENT")).toBe(true);
    expect(matchesPropertyType({ propertyType: "HOUSE", title: "Studio near the tower" }, "STUDIO")).toBe(false);
  });

  it("doesn't match on words that only contain the keyword", () => {
    expect(matchesPropertyType({ propertyType: "OTHER", title: "Lodgement suite" }, "LODGE")).toBe(false);
    expect(matchesPropertyType({ propertyType: "OTHER", title: "Flatford mill" }, "APARTMENT")).toBe(false);
    expect(matchesPropertyType({ propertyType: "OTHER", title: null }, "LODGE")).toBe(false);
  });
});
