import { describe, expect, it } from "vitest";
import { HEADER_NAV_LINKS, PRIMARY_NAV_LINKS, SECONDARY_NAV_LINKS } from "./primaryNav";
import { SITE_SECTIONS } from "./siteSections";

describe("HEADER_NAV_LINKS", () => {
  it("drops the links the section pills already cover", () => {
    expect(HEADER_NAV_LINKS.map((link) => link.label)).toEqual(["About"]);
  });

  it("leaves the full list for the mobile menus", () => {
    expect(PRIMARY_NAV_LINKS.map((link) => link.label)).toEqual(["Stays", "Experiences", "Services", "Saved", "About"]);
  });
});

describe("SECONDARY_NAV_LINKS", () => {
  it("never repeats a bottom-bar section", () => {
    const sectionHrefs = new Set(SITE_SECTIONS.map((section) => section.href));
    expect(SECONDARY_NAV_LINKS.filter((link) => sectionHrefs.has(link.href))).toEqual([]);
  });
});
