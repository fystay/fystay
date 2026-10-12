import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlaceDetails, isGooglePlacesConfigured, suggestPlaces, validSessionToken } from "./googlePlaces";

const json = (body: object, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

beforeEach(() => vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key"));
afterEach(() => vi.unstubAllEnvs());

describe("isGooglePlacesConfigured", () => {
  it("is on only with a key", () => {
    expect(isGooglePlacesConfigured({ GOOGLE_MAPS_API_KEY: "k" })).toBe(true);
    expect(isGooglePlacesConfigured({ GOOGLE_MAPS_API_KEY: "" })).toBe(false);
  });
});

describe("suggestPlaces", () => {
  it("returns nothing rather than throwing when Google is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(suggestPlaces("Stanley Park", { fetchImpl })).resolves.toEqual([]);
  });


  it("asks for UK places with the key in a header and maps the predictions", async () => {
    const fetchImpl = json({
      suggestions: [
        {
          placePrediction: {
            placeId: "ChIJ_stanley_park_bpl",
            text: { text: "Stanley Park, Blackpool, UK" },
            structuredFormat: { mainText: { text: "Stanley Park" }, secondaryText: { text: "Blackpool, UK" } },
          },
        },
        { placePrediction: { placeId: "bad id!", text: { text: "Ignored" } } },
        { queryPrediction: {} },
      ],
    });
    const result = await suggestPlaces("stanley park", { fetchImpl });
    expect(result).toEqual([{ placeId: "ChIJ_stanley_park_bpl", label: "Stanley Park", sublabel: "Blackpool, UK" }]);
    const [url, init] = (fetchImpl.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
    expect(JSON.parse(init.body as string)).toMatchObject({ input: "stanley park", includedRegionCodes: ["gb"] });
  });

  it("does nothing without a key, for short input, or when Google fails", async () => {
    const fetchImpl = json({}, false);
    expect(await suggestPlaces("st", { fetchImpl })).toEqual([]);
    expect(await suggestPlaces("stanley", { fetchImpl })).toEqual([]);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const unused = json({});
    expect(await suggestPlaces("stanley", { fetchImpl: unused })).toEqual([]);
    expect(unused).not.toHaveBeenCalled();
  });
});

describe("getPlaceDetails", () => {
  it("returns the name, address, coordinates and viewport, sending the session token", async () => {
    const fetchImpl = json({
      id: "ChIJ_place_one",
      displayName: { text: "Stanley Park" },
      formattedAddress: "Stanley Park, Blackpool, UK",
      location: { latitude: 53.81, longitude: -3.03 },
      viewport: { low: { latitude: 53.80, longitude: -3.04 }, high: { latitude: 53.82, longitude: -3.02 } },
    });
    expect(await getPlaceDetails("ChIJ_place_one", { sessionToken: "a1b2c3d4-e5f6-7890-abcd-ef0123456789", fetchImpl })).toEqual({
      placeId: "ChIJ_place_one",
      name: "Stanley Park",
      formattedAddress: "Stanley Park, Blackpool, UK",
      latitude: 53.81,
      longitude: -3.03,
      bounds: { south: 53.8, west: -3.04, north: 53.82, east: -3.02 },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("sessionToken=a1b2c3d4-e5f6-7890-abcd-ef0123456789");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toContain("viewport");
  });

  it("keeps the place but drops an inverted viewport", async () => {
    const fetchImpl = json({
      displayName: { text: "Somewhere" },
      location: { latitude: 53.81, longitude: -3.03 },
      viewport: { low: { latitude: 53.9, longitude: -3.0 }, high: { latitude: 53.8, longitude: -3.1 } },
    });
    expect((await getPlaceDetails("ChIJ_place_one", { fetchImpl }))?.bounds).toBeNull();
  });

  it("refuses malformed ids, out-of-range or incomplete answers, failures, and no key", async () => {
    expect(await getPlaceDetails("../../etc", { fetchImpl: json({}) })).toBeNull();
    expect(await getPlaceDetails("ChIJ_place_two", { fetchImpl: json({ displayName: { text: "No location" } }) })).toBeNull();
    expect(await getPlaceDetails("ChIJ_place_two", { fetchImpl: json({ displayName: { text: "X" }, location: { latitude: 123, longitude: 0 } }) })).toBeNull();
    expect(await getPlaceDetails("ChIJ_place_two", { fetchImpl: json({}, false) })).toBeNull();
    expect(await getPlaceDetails("ChIJ_place_two", { fetchImpl: vi.fn(async () => { throw new Error("down"); }) })).toBeNull();
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    expect(await getPlaceDetails("ChIJ_place_two", { fetchImpl: json({}) })).toBeNull();
  });
});

describe("session tokens", () => {
  it("accepts a UUID and passes it to autocomplete; ignores anything else", async () => {
    expect(validSessionToken("a1b2c3d4-e5f6-7890-abcd-ef0123456789")).toBeTruthy();
    expect(validSessionToken("bad token!")).toBeUndefined();
    expect(validSessionToken(null)).toBeUndefined();
    const fetchImpl = json({ suggestions: [] });
    await suggestPlaces("Stanley Park", { sessionToken: "a1b2c3d4-e5f6-7890-abcd-ef0123456789", fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).sessionToken).toBe("a1b2c3d4-e5f6-7890-abcd-ef0123456789");
  });
});
