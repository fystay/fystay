import { describe, expect, it } from "vitest";
import { HEADER_NAV_LINKS, PRIMARY_NAV_LINKS } from "./primaryNav";

describe("HEADER_NAV_LINKS", () => {
  it("drops the links the section pills already cover", () => {
    expect(HEADER_NAV_LINKS.map((link) => link.label)).toEqual(["About"]);
  });

  it("leaves the full list for the mobile menus", () => {
    expect(PRIMARY_NAV_LINKS.map((link) => link.label)).toEqual(["Stays", "Explore", "Travel", "Services", "About"]);
  });
});
