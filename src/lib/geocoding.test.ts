import { afterEach, describe, expect, it, vi } from "vitest";
import { fyldeCoastCenter, geocodeListing, locateListing } from "./geocoding";

describe("geocodeListing", () => {
  it("returns coordinates near Blackpool's town center for a Blackpool listing", () => {
    const result = geocodeListing({ id: "listing-1", city: "Blackpool" });
    expect(result).not.toBeNull();
    expect(result!.latitude).toBeCloseTo(53.8175, 1);
    expect(result!.longitude).toBeCloseTo(-3.0357, 1);
  });

  it("matches city names case-insensitively and ignores surrounding whitespace", () => {
    const exact = geocodeListing({ id: "listing-1", city: "Fleetwood" });
    const messy = geocodeListing({ id: "listing-1", city: "  FLEETWOOD  " });
    expect(messy).toEqual(exact);
  });

  it("returns null for a city outside FYStay's coverage rather than guessing", () => {
    expect(geocodeListing({ id: "listing-1", city: "Manchester" })).toBeNull();
  });

  it("is deterministic - the same id and city always jitters to the same point", () => {
    const first = geocodeListing({ id: "listing-42", city: "Thornton-Cleveleys" });
    const second = geocodeListing({ id: "listing-42", city: "Thornton-Cleveleys" });
    expect(first).toEqual(second);
  });

  it("jitters different listings in the same town to different points", () => {
    const a = geocodeListing({ id: "listing-a", city: "St Annes" });
    const b = geocodeListing({ id: "listing-b", city: "St Annes" });
    expect(a).not.toEqual(b);
  });
});

describe("fyldeCoastCenter", () => {
  it("returns a point roughly in the middle of FYStay's coverage area", () => {
    const center = fyldeCoastCenter();
    // All six towns sit within this rough box - a loose bound, just to
    // catch a badly broken average rather than pin an exact value.
    expect(center.latitude).toBeGreaterThan(53.7);
    expect(center.latitude).toBeLessThan(53.95);
    expect(center.longitude).toBeGreaterThan(-3.1);
    expect(center.longitude).toBeLessThan(-2.9);
  });
});

describe("geocodeListing jitter", () => {
  it("never moves a pin more than ~650m from the town centre, whatever the id", () => {
    for (let i = 0; i < 500; i++) {
      const pin = geocodeListing({ id: `cm${i}x${(i * 7919).toString(36)}`, city: "Blackpool" })!;
      expect(Math.abs(pin.latitude - 53.8175)).toBeLessThanOrEqual(0.006);
      expect(Math.abs(pin.longitude + 3.0357)).toBeLessThanOrEqual(0.006);
    }
  });
});

describe("locateListing", () => {
  afterEach(() => vi.unstubAllEnvs());
  const google = (latitude: number, longitude: number) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ places: [{ location: { latitude, longitude } }] }) }) as Response);

  it("places a listing anywhere in the UK from its address and town, blurred so the exact address never shows", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    const fetchImpl = google(54.6013, -3.1347); // Keswick
    const result = await locateListing(
      { id: "listing-9", city: "Keswick", country: "United Kingdom", address: "12 Main Street" },
      { fetchImpl },
    );
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).textQuery).toBe(
      "12 Main Street, Keswick, United Kingdom",
    );
    expect(result).not.toBeNull();
    // Moved, but by no more than ~400m.
    expect(result).not.toEqual({ latitude: 54.6013, longitude: -3.1347 });
    expect(Math.abs(result!.latitude - 54.6013)).toBeLessThanOrEqual(0.0036);
    expect(Math.abs(result!.longitude + 3.1347)).toBeLessThanOrEqual(0.0036);
    // The same listing always lands on the same spot.
    await expect(
      locateListing({ id: "listing-9", city: "Keswick", country: "United Kingdom", address: "12 Main Street" }, { fetchImpl }),
    ).resolves.toEqual(result);
  });

  it("falls back to FYStay's town table without Google, and to nothing for an unknown town", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    await expect(locateListing({ id: "l", city: "Blackpool" })).resolves.toEqual(geocodeListing({ id: "l", city: "Blackpool" }));
    await expect(locateListing({ id: "l", city: "Keswick" })).resolves.toBeNull();
  });
});
