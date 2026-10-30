import { describe, expect, it } from "vitest";
import { idSuffixFromSlug, listingSlug } from "./listingLinks";

const lodge = { id: "cmvuvwzp300047d6lo5cfrb9v", title: "Lodge on the Lake | 3-Bedroom Lakeside Retreat" };

describe("listingSlug", () => {
  it("is the name in words plus the end of the id", () => {
    expect(listingSlug(lodge)).toBe("lodge-on-the-lake-3-bedroom-lakeside-retreat-5cfrb9v".replace("5cfrb9v", "cfrb9v"));
  });
  it("copes with accents, symbols and an empty-looking title", () => {
    expect(listingSlug({ id: "abc123def456", title: "Café Étoile & Spa!" })).toBe("cafe-etoile-spa-def456");
    expect(listingSlug({ id: "abc123def456", title: "***" })).toBe("def456");
  });
  it("keeps a long title short", () => {
    const slug = listingSlug({ id: "abc123def456", title: "A ".repeat(100) });
    expect(slug.length).toBeLessThanOrEqual(67);
  });
});

describe("idSuffixFromSlug", () => {
  it("finds the id's end in a slug", () => {
    expect(idSuffixFromSlug(listingSlug(lodge))).toBe("cfrb9v");
    expect(idSuffixFromSlug("def456")).toBe("def456");
  });
  it("refuses something that has no id on the end", () => {
    expect(idSuffixFromSlug("lodge-on-the-lake")).toBeNull();
    expect(idSuffixFromSlug("x-ab")).toBeNull();
  });
});
