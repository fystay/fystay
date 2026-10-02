import { describe, expect, it } from "vitest";
import { activeSiteSection, SITE_SECTIONS } from "./siteSections";

describe("activeSiteSection", () => {
  it("treats the homepage as Stays", () => {
    expect(activeSiteSection("/")).toBe("stays");
  });

  it.each([
    ["/search", "stays"],
    ["/listings/abc123", "stays"],
    ["/hotels", "stays"],
    ["/hotels/blackpool/the-grand", "stays"],
    ["/destinations", "explore"],
    ["/destinations/lytham", "explore"],
    ["/travel-extras", "travel"],
    ["/services", "services"],
  ])("maps %s to %s", (pathname, expected) => {
    expect(activeSiteSection(pathname)).toBe(expected);
  });

  it("returns null outside the four sections", () => {
    for (const pathname of ["/account", "/host/dashboard", "/legal/terms", "/login", "/bookings/1"]) {
      expect(activeSiteSection(pathname)).toBeNull();
    }
  });

  it("does not match a different route that merely shares a prefix", () => {
    expect(activeSiteSection("/searching")).toBeNull();
    expect(activeSiteSection("/services-old")).toBeNull();
  });

  it("has exactly the four agreed sections, in order", () => {
    expect(SITE_SECTIONS.map((section) => section.label)).toEqual(["Stays", "Explore", "Travel", "Services"]);
  });
});
