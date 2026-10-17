/**
 * Google Places (New) for the search box: UK place, postcode and address
 * suggestions beyond FYStay's own towns and curated landmarks, and the
 * details (name, coordinates, viewport) of the one the guest picks. Called
 * from FYStay's own API routes only - the key never reaches the browser -
 * and off until GOOGLE_MAPS_API_KEY is set, like every other integration
 * (suggestions then come only from FYStay's own data).
 *
 * Session tokens: the search box makes one token per search session and
 * sends it with every autocomplete request and the final details request,
 * so Google bills them as one session rather than per keystroke.
 */
export function isGooglePlacesConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GOOGLE_MAPS_API_KEY?.trim());
}

export type PlaceSuggestion = { placeId: string; label: string; sublabel: string };
export type PlaceDetails = {
  placeId: string;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  /** Google's viewport for the place, when it has one. */
  bounds: { south: number; west: number; north: number; east: number } | null;
};

const PLACES_BASE = "https://places.googleapis.com/v1";
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,300}$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** A session token from the browser, or undefined if it isn't one. */
export function validSessionToken(value: string | null | undefined): string | undefined {
  return value && SESSION_TOKEN_PATTERN.test(value) ? value : undefined;
}

type AutocompleteResponse = {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }[];
};

/**
 * Google answered but refused (wrong or restricted key, API not enabled,
 * billing off, quota). Logged so the cause shows in the server logs - its
 * status and reason only, never the key.
 */
async function logRefusal(call: string, res: Response) {
  let reason: string | undefined;
  let message: string | undefined;
  try {
    const body = (await res.json()) as {
      error?: { status?: string; message?: string; details?: { reason?: string }[] };
    };
    reason = body.error?.details?.find((d) => d.reason)?.reason ?? body.error?.status;
    message = body.error?.message?.slice(0, 200);
  } catch {
    // not JSON - the HTTP status is enough
  }
  console.warn("Google Places refused the request", { call, status: res.status, reason, message });
}

export async function suggestPlaces(
  input: string,
  { limit = 4, sessionToken, fetchImpl = fetch }: { limit?: number; sessionToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<PlaceSuggestion[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key || input.trim().length < 3) return [];
  let data: AutocompleteResponse;
  try {
    const res = await fetchImpl(`${PLACES_BASE}/places:autocomplete`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({
        input: input.trim().slice(0, 100),
        includedRegionCodes: ["gb"],
        languageCode: "en-GB",
        ...(sessionToken && { sessionToken }),
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      await logRefusal("autocomplete", res);
      return [];
    }
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

type LatLng = { latitude?: number; longitude?: number };
type DetailsResponse = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: LatLng;
  viewport?: { low?: LatLng; high?: LatLng };
};

const isLat = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= -90 && n <= 90;
const isLng = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180;

/**
 * The details of the place a guest picked: name, address, coordinates and
 * viewport. Sent with the session token, which closes Google's billing
 * session for that search. Null when unconfigured, on a bad id, or when
 * Google fails or gives an incomplete answer - never a guess.
 */
export async function getPlaceDetails(
  placeId: string,
  { sessionToken, fetchImpl = fetch }: { sessionToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<PlaceDetails | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key || !PLACE_ID_PATTERN.test(placeId)) return null;
  const query = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : "";
  try {
    const res = await fetchImpl(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}${query}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,formattedAddress,location,viewport" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      await logRefusal("details", res);
      return null;
    }
    const data = (await res.json()) as DetailsResponse;
    const { latitude, longitude } = data.location ?? {};
    const name = data.displayName?.text;
    if (!isLat(latitude) || !isLng(longitude) || !name) return null;
    const low = data.viewport?.low;
    const high = data.viewport?.high;
    const bounds =
      low && high && isLat(low.latitude) && isLng(low.longitude) && isLat(high.latitude) && isLng(high.longitude) &&
      low.latitude < high.latitude && low.longitude < high.longitude
        ? { south: low.latitude, west: low.longitude, north: high.latitude, east: high.longitude }
        : null;
    return { placeId, name, formattedAddress: data.formattedAddress ?? name, latitude, longitude, bounds };
  } catch {
    return null;
  }
}

type TextSearchResponse = { places?: { location?: LatLng }[] };

// Great Britain and Northern Ireland, with a little margin - a result
// outside it is Google matching the wrong place, never a UK stay.
const UK_BOUNDS = { south: 49.8, west: -8.7, north: 60.9, east: 1.8 };

/**
 * Where a free-text UK location is - a listing's "address, town" - from
 * Places Text Search (New), asking only for the location field. One call
 * per listing created or moved, never per search. Null when unconfigured,
 * when Google fails, or when the best match lies outside the UK.
 */
export async function findUkLocation(
  query: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<{ latitude: number; longitude: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const textQuery = query.trim().slice(0, 300);
  if (!key || textQuery.length < 2) return null;
  try {
    const res = await fetchImpl(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.location" },
      body: JSON.stringify({ textQuery, regionCode: "GB", languageCode: "en-GB", pageSize: 1 }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      await logRefusal("searchText", res);
      return null;
    }
    const data = (await res.json()) as TextSearchResponse;
    const { latitude, longitude } = data.places?.[0]?.location ?? {};
    if (!isLat(latitude) || !isLng(longitude)) return null;
    const inUk =
      latitude >= UK_BOUNDS.south && latitude <= UK_BOUNDS.north && longitude >= UK_BOUNDS.west && longitude <= UK_BOUNDS.east;
    return inUk ? { latitude, longitude } : null;
  } catch {
    return null;
  }
}
