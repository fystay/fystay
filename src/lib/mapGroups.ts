/** A stay as the results map shows it: only stays with coordinates. */
export type MapListing = {
  id: string;
  title: string;
  city: string;
  photo: string | null;
  pricePerNightCents: number;
  latitude: number;
  longitude: number;
};

export type MapGroup = { key: string; listings: MapListing[]; latitude: number; longitude: number };

/**
 * Stays whose price pills would overlap at the current zoom, grouped into
 * one "N stays" pill (greedy, by on-screen distance - plenty for a coast's
 * worth of listings, no clustering library needed). Re-worked out on every
 * zoom or pan; tapping a group zooms in to it.
 */
export const GROUP_RADIUS_PX = 56;

export function groupListings(
  listings: MapListing[],
  toPixel: (listing: MapListing) => { x: number; y: number },
  radius = GROUP_RADIUS_PX,
): MapGroup[] {
  const groups: (MapGroup & { x: number; y: number })[] = [];
  for (const listing of listings) {
    const point = toPixel(listing);
    const near = groups.find((g) => Math.hypot(g.x - point.x, g.y - point.y) < radius);
    if (near) {
      near.listings.push(listing);
      continue;
    }
    groups.push({ key: listing.id, listings: [listing], latitude: listing.latitude, longitude: listing.longitude, ...point });
  }
  return groups.map(({ key, listings: members }) => ({
    key,
    listings: members,
    latitude: members.reduce((sum, l) => sum + l.latitude, 0) / members.length,
    longitude: members.reduce((sum, l) => sum + l.longitude, 0) / members.length,
  }));
}

