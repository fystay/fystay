import { describe, expect, it } from "vitest";
import { DEFAULT_SHARE_IMAGE, pageMetadata, withCity } from "./seo";

describe("withCity", () => {
  it("leaves a title that already names the city untouched", () => {
    expect(withCity("Cosy cottage near Fleetwood Marina", "Fleetwood")).toBe(
      "Cosy cottage near Fleetwood Marina",
    );
  });

  it("appends the city when the title doesn't mention it", () => {
    expect(withCity("Sunny two-bed flat", "Blackpool")).toBe("Sunny two-bed flat in Blackpool");
  });

  it("matches the city case-insensitively", () => {
    expect(withCity("A stay in BLACKPOOL town centre", "Blackpool")).toBe(
      "A stay in BLACKPOOL town centre",
    );
  });
});

describe("pageMetadata", () => {
  it("gives every content page the FYStay share image, which Next would otherwise drop", () => {
    const metadata = pageMetadata({ title: "About", description: "Why FYStay exists.", path: "/about" });
    expect(metadata.openGraph?.images).toEqual([DEFAULT_SHARE_IMAGE]);
    expect(metadata.twitter?.images).toEqual([DEFAULT_SHARE_IMAGE]);
    expect(metadata.alternates?.canonical).toMatch(/\/about$/);
  });
});
