import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  extractListingWithAi,
  fetchPublicListingText,
  htmlToListingText,
  IMPORT_USER_AGENT,
  robotsAllows,
  robotsRules,
} from "./listingImport";

const page = (status: number, text = "") => ({ status, ok: status >= 200 && status < 300, text, finalUrl: "https://example.test/rooms/1" });
const LONG_HTML = `<html><head><title>Sea View Flat</title></head><body><p>${"Bright two-bedroom flat by the sea. ".repeat(20)}</p></body></html>`;

describe("robots.txt", () => {
  const txt = `User-agent: *\nDisallow: /rooms/\nAllow: /rooms/public\n\nUser-agent: Googlebot\nDisallow: /`;

  it("applies the * group's longest matching rule", () => {
    const rules = robotsRules(txt);
    expect(robotsAllows(rules, "/rooms/123")).toBe(false);
    expect(robotsAllows(rules, "/rooms/public/9")).toBe(true);
    expect(robotsAllows(rules, "/about")).toBe(true);
  });

  it("supports wildcards and end anchors", () => {
    const rules = robotsRules("User-agent: *\nDisallow: /*.json$\nDisallow: /search*q=");
    expect(robotsAllows(rules, "/x/data.json")).toBe(false);
    expect(robotsAllows(rules, "/x/data.json?a=1")).toBe(true);
    expect(robotsAllows(rules, "/search?page=2&q=x")).toBe(false);
  });
});

describe("htmlToListingText", () => {
  it("keeps visible text and public structured data, drops scripts and styles", () => {
    const text = htmlToListingText(
      `<title>Flat &amp; Garden</title><meta name="description" content="Two beds"><script>track()</script><style>p{}</style>` +
        `<script type="application/ld+json">{"@type":"LodgingBusiness"}</script><p>Sleeps&nbsp;4</p>`,
    );
    expect(text).toContain("Page title: Flat & Garden");
    expect(text).toContain("description: Two beds");
    expect(text).toContain('Structured data: {"@type":"LodgingBusiness"}');
    expect(text).toContain("Sleeps 4");
    expect(text).not.toContain("track()");
  });
});

describe("fetchPublicListingText", () => {
  it("doesn't read a page robots.txt keeps tools out of", async () => {
    const fetchText = vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? page(200, "User-agent: *\nDisallow: /rooms/") : page(200, LONG_HTML)));
    const result = await fetchPublicListingText("https://example.test/rooms/1", fetchText);
    expect(result).toMatchObject({ ok: false });
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("stops when the site blocks it or asks for a sign-in, and asks for pasted text", async () => {
    const blocked = vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? page(404) : page(403)));
    const r1 = await fetchPublicListingText("https://example.test/rooms/1", blocked);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toMatch(/paste/i);

    const login = vi.fn(async (url: string) =>
      url.endsWith("/robots.txt") ? page(404) : page(200, `<p>${"Sign in to continue ".repeat(15)}</p><input type="password">`),
    );
    expect((await fetchPublicListingText("https://example.test/rooms/1", login)).ok).toBe(false);
  });

  it("doesn't go in when it can't confirm robots.txt allows it", async () => {
    const fetchText = vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? page(503) : page(200, LONG_HTML)));
    expect((await fetchPublicListingText("https://example.test/rooms/1", fetchText)).ok).toBe(false);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("reads an allowed public page with an honest user agent and no cookies", async () => {
    const fetchText = vi.fn(async (url: string) => (url.endsWith("/robots.txt") ? page(404) : page(200, LONG_HTML)));
    const result = await fetchPublicListingText("https://example.test/rooms/1#photos", fetchText);
    expect(result.ok).toBe(true);
    expect(fetchText).toHaveBeenLastCalledWith("https://example.test/rooms/1", expect.objectContaining({ userAgent: IMPORT_USER_AGENT }));
    expect(JSON.stringify(fetchText.mock.calls)).not.toMatch(/cookie/i);
  });

  it("only takes https links", async () => {
    const fetchText = vi.fn();
    expect((await fetchPublicListingText("http://example.test/rooms/1", fetchText)).ok).toBe(false);
    expect(fetchText).not.toHaveBeenCalled();
  });
});

describe("extractListingWithAi", () => {
  const client = (parsed: object | null, stop_reason = "end_turn") =>
    ({ beta: { messages: { parse: vi.fn(async () => ({ parsed_output: parsed, stop_reason })) } } }) as unknown as Pick<Anthropic, "beta">;
  const base = {
    title: "Sea view flat",
    description: "A bright flat.",
    propertyType: "APARTMENT",
    address: null,
    city: "Blackpool",
    country: "United Kingdom",
    bedrooms: 2,
    bathrooms: 1,
    maxGuests: 4,
    amenities: ["wifi", "Helipad"],
    houseRules: null,
    pricePerNight: 95,
    priceCurrency: "GBP",
    uncertain: [],
  };

  it("keeps only FYStay amenities, converts a nightly price in pounds and lists what's missing", async () => {
    const result = await extractListingWithAi({ text: "x" }, client(base));
    expect(result.draft.amenities).toEqual(["Wifi"]);
    expect(result.draft.pricePerNightCents).toBe(9500);
    expect(result.missing).toEqual([]);
  });

  it("never converts another currency - it flags the price instead", async () => {
    const result = await extractListingWithAi({ text: "x" }, client({ ...base, pricePerNight: 120, priceCurrency: "EUR" }));
    expect(result.draft.pricePerNightCents).toBeNull();
    expect(result.missing).toContain("pricePerNightCents");
    expect(result.uncertain.some((u) => u.field === "pricePerNightCents")).toBe(true);
  });

  it("drops impossible numbers rather than saving them", async () => {
    const result = await extractListingWithAi({ text: "x" }, client({ ...base, bedrooms: 400, maxGuests: 0 }));
    expect(result.draft.bedrooms).toBeNull();
    expect(result.draft.maxGuests).toBeNull();
    expect(result.missing).toEqual(expect.arrayContaining(["bedrooms", "maxGuests"]));
  });

  it("reports a refusal instead of making something up", async () => {
    await expect(extractListingWithAi({ text: "x" }, client(null, "refusal"))).rejects.toThrow(/by hand/);
  });
});
