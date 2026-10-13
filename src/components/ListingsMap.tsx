"use client";

import dynamic from "next/dynamic";
import type { MapListing } from "@/components/ListingsMapInner";

/** The place a search was for, to open the map on: its point and, for a whole town or area, its extent. */
export type MapFocus = {
  latitude: number;
  longitude: number;
  bounds?: { south: number; west: number; north: number; east: number } | null;
};

function MapLoading() {
  return (
    <div className="skeleton-shimmer flex h-[480px] w-full items-center justify-center rounded-2xl">
      <p className="text-sm text-stone-500">Loading map…</p>
    </div>
  );
}

// Both maps only ever run in the browser, and only load when the Map view
// is open - the list view never downloads either. Leaflet touches `window`
// as soon as its module evaluates, hence `ssr: false`.
const GoogleListingsMap = dynamic(() => import("@/components/GoogleListingsMap").then((m) => m.GoogleListingsMap), {
  ssr: false,
  loading: MapLoading,
});
const ListingsMapInner = dynamic(
  () => import("@/components/ListingsMapInner").then((m) => m.ListingsMapInner),
  { ssr: false, loading: MapLoading },
);

// The browser key (Maps JavaScript API only, restricted to FYStay's own
// addresses). Without it - local development, or before it's set up - the
// OpenStreetMap map stands in, so the Map view always works.
const GOOGLE_MAPS_BROWSER_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim();

export function ListingsMap({ listings, focus = null }: { listings: MapListing[]; focus?: MapFocus | null }) {
  if (GOOGLE_MAPS_BROWSER_KEY) {
    return <GoogleListingsMap apiKey={GOOGLE_MAPS_BROWSER_KEY} listings={listings} focus={focus} />;
  }
  return <ListingsMapInner listings={listings} />;
}
