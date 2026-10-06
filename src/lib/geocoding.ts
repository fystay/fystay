import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";

/**
 * Approximate town-center coordinates for every town FYStay actually
 * covers - not real per-property geocoding (this app has none), and
 * deliberately keyed off the same fixed list that already drives the
 * /destinations town tiles and the homepage's "Now covering"
 * badges, so a listing only ever gets a map pin for a place FYStay
 * genuinely serves.
 */
export const TOWN_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  blackpool: { latitude: 53.8175, longitude: -3.0357 },
  lytham: { latitude: 53.7423, longitude: -2.9583 },
  "st annes": { latitude: 53.7519, longitude: -2.9622 },
  "poulton-le-fylde": { latitude: 53.8483, longitude: -2.9883 },
  fleetwood: { latitude: 53.9231, longitude: -3.0122 },
  "thornton-cleveleys": { latitude: 53.8767, longitude: -3.0472 },
};

// Every known town's coordinates are within this radius, so a search-page
// callers can also sanity-check "did this listing get a real map pin"
// without importing TOWN_COORDINATES directly.
const JITTER_DEGREES = 0.006; // ~650m at this latitude - plausible within a town, never crosses into a neighbouring one.

/** A small, deterministic (not random) offset derived from the listing's own
 * id, so the same listing always lands on the same pixel and multiple
 * listings in the same town don't stack exactly on top of each other -
 * without needing to store the jittered value or reroll it on every render. */
function deterministicJitter(seed: string): { dx: number; dy: number } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  // Two independent-looking axes from one hash by mixing in a different
  // multiplier per axis, then folding into [-1, 1].
  const axis = (mult: number) => (((hash * mult) % 2000) / 1000) - 1;
  return { dx: axis(48271), dy: axis(16807) };
}

/**
 * Looks up approximate coordinates for a listing's city, with a small
 * deterministic jitter keyed on its id. Returns null for any city outside
 * FYStay's actual coverage - never a fallback or guessed location, since a
 * wrong pin is worse than no pin at all.
 */
export function geocodeListing(params: {
  id: string;
  city: string;
}): { latitude: number; longitude: number } | null {
  const town = TOWN_COORDINATES[params.city.trim().toLowerCase()];
  if (!town) return null;

  const { dx, dy } = deterministicJitter(params.id);
  return {
    latitude: town.latitude + dy * JITTER_DEGREES,
    longitude: town.longitude + dx * JITTER_DEGREES,
  };
}

/** Every town FYStay covers, for a map's default view when nothing is selected yet. */
export function fyldeCoastCenter(): { latitude: number; longitude: number } {
  const towns = FYLDE_COAST_DESTINATIONS.map((d) => TOWN_COORDINATES[d.searchCity.toLowerCase()]).filter(
    (t): t is { latitude: number; longitude: number } => Boolean(t),
  );
  return {
    latitude: towns.reduce((sum, t) => sum + t.latitude, 0) / towns.length,
    longitude: towns.reduce((sum, t) => sum + t.longitude, 0) / towns.length,
  };
}
