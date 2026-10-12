import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlaceLocation, isGooglePlacesConfigured, suggestPlaces } from "./googlePlaces";

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

describe("getPlaceLocation", () => {
  it("returns the server-looked-up name and coordinates", async () => {
    const fetchImpl = json({ id: "ChIJ_place_one", displayName: { text: "Stanley Park" }, location: { latitude: 53.81, longitude: -3.03 } });
    expect(await getPlaceLocation("ChIJ_place_one", fetchImpl)).toEqual({
      placeId: "ChIJ_place_one",
      name: "Stanley Park",
      latitude: 53.81,
      longitude: -3.03,
    });
  });

  it("refuses malformed ids and incomplete answers", async () => {
    const fetchImpl = json({ displayName: { text: "No location" } });
    expect(await getPlaceLocation("../../etc", fetchImpl)).toBeNull();
    expect(await getPlaceLocation("ChIJ_place_two", fetchImpl)).toBeNull();
  });
});
