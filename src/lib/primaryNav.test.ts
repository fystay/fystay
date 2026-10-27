import { describe, expect, it } from "vitest";
import { SITE_INFO_LINKS } from "./primaryNav";
import { SITE_SECTIONS } from "./siteSections";

describe("SITE_INFO_LINKS", () => {
  it("never repeats a section", () => {
    const sectionHrefs = new Set(SITE_SECTIONS.map((section) => section.href));
    expect(SITE_INFO_LINKS.filter((link) => sectionHrefs.has(link.href))).toEqual([]);
  });
});
