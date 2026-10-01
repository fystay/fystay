import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./baseUrl";

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes so joined paths never double up", () => {
    expect(normalizeBaseUrl("https://fystay.vercel.app/")).toBe("https://fystay.vercel.app");
    expect(normalizeBaseUrl("https://fystay.vercel.app//")).toBe("https://fystay.vercel.app");
    expect(`${normalizeBaseUrl("https://x.test/")}/sitemap.xml`).toBe("https://x.test/sitemap.xml");
  });

  it("leaves a clean value alone and falls back locally", () => {
    expect(normalizeBaseUrl("https://x.test")).toBe("https://x.test");
    expect(normalizeBaseUrl(undefined)).toBe("http://localhost:3000");
    expect(normalizeBaseUrl("  ")).toBe("http://localhost:3000");
  });
});
