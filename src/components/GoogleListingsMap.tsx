"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AdvancedMarker,
  APILoadingStatus,
  APIProvider,
  InfoWindow,
  Map,
  useApiLoadingStatus,
  useMap,
} from "@vis.gl/react-google-maps";
import { useFormattedPrice } from "@/components/CurrencyProvider";
import { isOptimizableImage } from "@/lib/image";
import { groupListings, type MapGroup, type MapListing } from "@/lib/mapGroups";
import type { MapFocus } from "@/components/ListingsMap";

/**
 * The results map on Google Maps (Maps JavaScript API), with the
 * browser-only key NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY - restricted in
 * Google Cloud to FYStay's own web addresses and to the Maps JavaScript
 * API alone, so it's useless anywhere else. Opens on the place the guest
 * searched for, then fits every stay's pin in view. Pins near each other
 * on screen merge into one "N stays" pill; tapping a stay opens a preview
 * with its photo, price and a link to the listing.
 *
 * A pin is never a stay's exact address - see locateListing.
 */

// A Map ID turns on Google's vector map and the price-pill markers.
// DEMO_MAP_ID is Google's own, fine for trying the map out.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";
// Close enough to read the streets around a single stay, never closer.
const MAX_FIT_ZOOM = 15;
const DEFAULT_ZOOM = 12;

export function GoogleListingsMap({
  apiKey,
  listings,
  focus,
}: {
  apiKey: string;
  listings: MapListing[];
  focus: MapFocus | null;
}) {
  const [failed, setFailed] = useState(false);
  // Google calls window.gm_authFailure when it refuses the key (wrong key,
  // site not allowed, API or billing off) - its own grey error box would
  // otherwise fill the map. FYStay's message, pointing back to the list,
  // shows instead.
  useEffect(() => {
    const w = window as Window & { gm_authFailure?: () => void };
    const previous = w.gm_authFailure;
    w.gm_authFailure = () => {
      console.error("Google Maps refused the browser key");
      setFailed(true);
    };
    return () => {
      w.gm_authFailure = previous;
    };
  }, []);
  const start = focus ?? (listings[0] ? { latitude: listings[0].latitude, longitude: listings[0].longitude } : null);
  if (failed || !start) return <MapUnavailable />;

  return (
    <APIProvider apiKey={apiKey} region="GB" language="en-GB" onError={() => setFailed(true)}>
      <div className="relative h-[480px] w-full overflow-hidden rounded-2xl bg-surface-muted sm:h-[560px]">
        <Map
          mapId={MAP_ID}
          defaultCenter={{ lat: start.latitude, lng: start.longitude }}
          defaultZoom={DEFAULT_ZOOM}
          gestureHandling="cooperative"
          disableDefaultUI
          zoomControl
          fullscreenControl
          clickableIcons={false}
          className="h-full w-full"
        >
          <FitToResults listings={listings} focus={focus} />
          <Markers listings={listings} />
        </Map>
        <LoadingState onFailure={() => setFailed(true)} />
      </div>
    </APIProvider>
  );
}

/** "Loading map…" until Google's script is in, and the fallback if the key is refused. */
function LoadingState({ onFailure }: { onFailure: () => void }) {
  const status = useApiLoadingStatus();
  useEffect(() => {
    if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) onFailure();
  }, [status, onFailure]);
  if (status === APILoadingStatus.LOADED) return null;
  return (
    <div className="skeleton-shimmer absolute inset-0 flex items-center justify-center" aria-live="polite">
      <p className="text-sm text-stone-500">Loading map…</p>
    </div>
  );
}

function MapUnavailable() {
  return (
    <div
      role="status"
      className="flex h-[480px] w-full flex-col items-center justify-center gap-1 rounded-2xl border border-border-subtle bg-surface-muted px-6 text-center"
    >
      <p className="font-semibold text-foreground">The map couldn&apos;t load</p>
      <p className="text-sm text-stone-500">Your search is unchanged - switch to List to see the same stays.</p>
    </div>
  );
}

/**
 * Brings every stay into view, with the searched place: on first load and
 * whenever the results change (a new search or filter). A single stay, or
 * none, centres on the search itself.
 */
function FitToResults({ listings, focus }: { listings: MapListing[]; focus: MapFocus | null }) {
  const map = useMap();
  const key = listings.map((l) => l.id).join(",") + (focus ? `@${focus.latitude},${focus.longitude}` : "");
  useEffect(() => {
    if (!map) return;
    if (listings.length === 0 && focus?.bounds) {
      map.fitBounds(focus.bounds, 24);
      return;
    }
    const points = listings.map((l) => ({ lat: l.latitude, lng: l.longitude }));
    if (focus) points.push({ lat: focus.latitude, lng: focus.longitude });
    if (points.length <= 1) {
      if (points[0]) map.setCenter(points[0]);
      map.setZoom(DEFAULT_ZOOM + 1);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const point of points) bounds.extend(point);
    map.fitBounds(bounds, 48);
    google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM);
    });
    // Only when the stays shown or the search change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

/** Stay pins, merged where they'd overlap at the current zoom. */
function Markers({ listings }: { listings: MapListing[] }) {
  const map = useMap();
  // The zoom the pins were last grouped for, updated whenever the map
  // settles; the groups themselves follow from it and the stays shown.
  const [zoom, setZoom] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => setZoom(map.getZoom() ?? null));
    return () => listener.remove();
  }, [map]);

  const groups = useMemo<MapGroup[]>(() => {
    const projection = map?.getProjection();
    if (!projection || zoom === null) return [];
    const scale = 2 ** zoom;
    return groupListings(listings, (l) => {
      const point = projection.fromLatLngToPoint({ lat: l.latitude, lng: l.longitude })!;
      return { x: point.x * scale, y: point.y * scale };
    });
  }, [map, zoom, listings]);

  // A new search or filter drops a preview for a stay no longer shown.
  const selected = listings.find((l) => l.id === selectedId) ?? null;
  const setSelected = (listing: MapListing | null) => setSelectedId(listing?.id ?? null);

  function zoomInto(group: MapGroup) {
    if (!map) return;
    const bounds = new google.maps.LatLngBounds();
    for (const l of group.listings) bounds.extend({ lat: l.latitude, lng: l.longitude });
    const before = map.getZoom() ?? DEFAULT_ZOOM;
    map.fitBounds(bounds, 80);
    // Stays at (almost) the same spot: zoom in a couple of steps anyway.
    google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) <= before) map.setZoom(before + 2);
    });
  }

  return (
    <>
      {groups.map((group) =>
        group.listings.length === 1 ? (
          <StayPin key={group.key} listing={group.listings[0]} onSelect={setSelected} />
        ) : (
          <GroupPin key={`group-${group.key}-${group.listings.length}`} group={group} onSelect={zoomInto} />
        ),
      )}
      {selected && (
        <InfoWindow
          position={{ lat: selected.latitude, lng: selected.longitude }}
          pixelOffset={[0, -18]}
          onCloseClick={() => setSelected(null)}
          headerDisabled
          minWidth={220}
        >
          <StayPreview listing={selected} onClose={() => setSelected(null)} />
        </InfoWindow>
      )}
    </>
  );
}

const PILL =
  "focus-ring whitespace-nowrap rounded-full bg-brand-700 px-2.5 py-1 text-[12.5px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] hover:bg-brand-800";

function StayPin({ listing, onSelect }: { listing: MapListing; onSelect: (l: MapListing) => void }) {
  const price = useFormattedPrice(listing.pricePerNightCents);
  return (
    <AdvancedMarker
      position={{ lat: listing.latitude, lng: listing.longitude }}
      title={`${listing.title}, ${price} a night`}
      onClick={() => onSelect(listing)}
    >
      <span className={PILL}>{price}</span>
    </AdvancedMarker>
  );
}

function GroupPin({ group, onSelect }: { group: MapGroup; onSelect: (g: MapGroup) => void }) {
  const from = useFormattedPrice(Math.min(...group.listings.map((l) => l.pricePerNightCents)));
  return (
    <AdvancedMarker
      position={{ lat: group.latitude, lng: group.longitude }}
      title={`${group.listings.length} stays - zoom in to see them`}
      onClick={() => onSelect(group)}
      zIndex={1}
    >
      <span className={PILL}>
        {group.listings.length} stays · from {from}
      </span>
    </AdvancedMarker>
  );
}

function StayPreview({ listing, onClose }: { listing: MapListing; onClose: () => void }) {
  const price = useFormattedPrice(listing.pricePerNightCents);
  return (
    <div className="relative w-[220px] font-sans">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="focus-ring absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow"
      >
        ×
      </button>
      <Link href={`/listings/${listing.id}`} className="flex flex-col gap-2 no-underline">
        <div className="relative h-28 w-full overflow-hidden rounded-lg bg-surface-muted">
          {listing.photo && (
            <Image
              src={listing.photo}
              alt={listing.title}
              fill
              className="object-cover"
              sizes="220px"
              unoptimized={!isOptimizableImage(listing.photo)}
            />
          )}
        </div>
        <div>
          <p className="truncate text-sm font-semibold text-foreground">{listing.title}</p>
          <p className="text-xs text-stone-500">{listing.city}</p>
          <p className="mt-1 text-sm font-bold text-brand-800">
            {price}
            <span className="text-xs font-normal text-stone-500"> / night</span>
          </p>
          <p className="mt-1 text-xs font-medium text-brand-700 underline">View stay</p>
        </div>
      </Link>
    </div>
  );
}
