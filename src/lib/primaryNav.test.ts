import { describe, expect, it } from "vitest";
import { HEADER_NAV_LINKS, SECONDARY_NAV_LINKS } from "./primaryNav";

describe("nav links", () => {
  it("keeps only About in the desktop header", () => {
    expect(HEADER_NAV_LINKS.map((link) => link.label)).toEqual(["About"]);
  });

  it("never offers Saved, Experiences or Services in the site menu", () => {
    const hrefs = SECONDARY_NAV_LINKS.map((link) => link.href);
    expect(hrefs).not.toContain("/wishlist");
    expect(hrefs).not.toContain("/destinations");
    expect(hrefs).not.toContain("/services");
  });
});
