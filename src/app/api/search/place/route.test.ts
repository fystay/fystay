import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ details: vi.fn(), allowed: true }));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: mocks.allowed, remaining: 1, resetAt: new Date() }),
  clientIp: () => "203.0.113.9",
  rateLimitedResponse: () => new Response("{}", { status: 429 }),
}));
vi.mock("@/lib/googlePlaces", async (orig) => ({
  ...(await orig<typeof import("@/lib/googlePlaces")>()),
  getPlaceDetails: (...a: unknown[]) => mocks.details(...a),
}));

import { GET } from "./route";

const get = (query: string) => GET(new Request(`http://x/api/search/place?${query}`));

beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
  mocks.details.mockReset();
  mocks.allowed = true;
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/search/place", () => {
  it("returns the picked place's details, passing the session token through", async () => {
    const place = { placeId: "ChIJ_place_one", name: "Stanley Park", formattedAddress: "Blackpool", latitude: 53.81, longitude: -3.03, bounds: null };
    mocks.details.mockResolvedValue(place);
    const res = await get("id=ChIJ_place_one&session=a1b2c3d4-e5f6-7890-abcd-ef0123456789");
    expect(res.status).toBe(200);
    expect((await res.json()).place).toEqual(place);
    expect(mocks.details).toHaveBeenCalledWith("ChIJ_place_one", { sessionToken: "a1b2c3d4-e5f6-7890-abcd-ef0123456789" });
  });

  it("says plainly when Google is off, the id is bad, the lookup fails or it's rate limited", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    expect((await get("id=ChIJ_place_one")).status).toBe(503);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
    expect((await get("id=../etc")).status).toBe(400);
    mocks.details.mockResolvedValue(null);
    const failed = await get("id=ChIJ_place_one&session=bad token");
    expect(failed.status).toBe(502);
    expect(mocks.details).toHaveBeenCalledWith("ChIJ_place_one", { sessionToken: undefined });
    mocks.allowed = false;
    expect((await get("id=ChIJ_place_one")).status).toBe(429);
  });
});
