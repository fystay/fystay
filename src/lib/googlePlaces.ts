import { cache } from "react";

/**
 * Google Places (New) for the search box: UK place and postcode suggestions
 * beyond FYStay's own towns and curated landmarks, and the coordinates of a
 * chosen place so results can be sorted nearest-first. Server-side only -
 * the key never reaches the browser - and off until GOOGLE_MAPS_API_KEY is
 * set, like every other integration (suggestions then come only from
 * FYStay's own data, and ?place= is ignored).
 */
export function isGooglePlacesConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GOOGLE_MAPS_API_KEY?.trim());
}

export type PlaceSuggestion = { placeId: string; label: string; sublabel: string };
export type PlaceLocation = { placeId: string; name: string; latitude: number; longitude: number };

const PLACES_BASE = "https://places.googleapis.com/v1";
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,300}$/;

type AutocompleteResponse = {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }[];
};

export async function suggestPlaces(
  input: string,
  { limit = 4, fetchImpl = fetch }: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<PlaceSuggestion[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key || input.trim().length < 3) return [];
  let data: AutocompleteResponse;
  try {
    const res = await fetchImpl(`${PLACES_BASE}/places:autocomplete`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({ input: input.trim().slice(0, 100), includedRegionCodes: ["gb"], languageCode: "en-GB" }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    data = (await res.json()) as AutocompleteResponse;
  } catch {
    // A slow or failing Google never breaks the search box - FYStay's own
    // suggestions still show.
    return [];
  }
  const suggestions: PlaceSuggestion[] = [];
  for (const { placePrediction: p } of data.suggestions ?? []) {
    if (!p?.placeId || !PLACE_ID_PATTERN.test(p.placeId)) continue;
    const label = p.structuredFormat?.mainText?.text ?? p.text?.text;
    if (!label) continue;
    suggestions.push({ placeId: p.placeId, label, sublabel: p.structuredFormat?.secondaryText?.text ?? "" });
    if (suggestions.length >= limit) break;
  }
  return suggestions;
}

type DetailsResponse = { id?: string; displayName?: { text?: string }; location?: { latitude?: number; longitude?: number } };

/**
 * The coordinates and name of a place chosen in the search box, looked up
 * on the server from its place id - never coordinates taken from the URL.
 * Cached for a day (place locations don't move) and per request.
 */
export const getPlaceLocation = cache(async (placeId: string, fetchImpl: typeof fetch = fetch): Promise<PlaceLocation | null> => {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key || !PLACE_ID_PATTERN.test(placeId)) return null;
  try {
    const res = await fetchImpl(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,location" },
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(3000),
    } as RequestInit);
    if (!res.ok) return null;
    const data = (await res.json()) as DetailsResponse;
    const { latitude, longitude } = data.location ?? {};
    const name = data.displayName?.text;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !name) return null;
    return { placeId, name, latitude, longitude };
  } catch {
    return null;
  }
});
