"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useFormattedPrice } from "@/components/CurrencyProvider";
import { isOptimizableImage } from "@/lib/image";
import { fyldeCoastCenter } from "@/lib/geocoding";
import { guestNightlyPriceCents } from "@/lib/pricing";

export type MapListing = {
  id: string;
  title: string;
  city: string;
  photo: string | null;
  pricePerNightCents: number;
  latitude: number;
  longitude: number;
};

/**
 * A price-pill marker (matching how Airbnb's own map reads at a glance)
 * rather than Leaflet's default pin: an L.divIcon rendering plain HTML,
 * since Leaflet's own icon system predates React and isn't a place
 * components can render into directly - only the popup content below is
 * real React. Takes an already-formatted label rather than raw cents,
 * since this plain function (not a component) can't call the
 * useFormattedPrice hook itself - see ListingMarker below.
 */
function priceIcon(label: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      background: var(--color-brand-700, #954328);
      color: white;
      font-weight: 600;
      font-size: 12.5px;
      padding: 5px 10px;
      border-radius: 999px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      white-space: nowrap;
      font-family: inherit;
    ">${label}</div>`,
    iconSize: undefined,
    iconAnchor: [30, 15],
  });
}

/**
 * Its own component (rather than inline in the .map() below) purely so
 * useFormattedPrice - a hook - can be called once per marker: calling a
 * hook inside a .map() callback itself would break React's rules of hooks
 * the moment the listings count ever changed between renders.
 */
function ListingMarker({ listing }: { listing: MapListing }) {
  const formattedPrice = useFormattedPrice(guestNightlyPriceCents(listing.pricePerNightCents));

  return (
    <Marker position={[listing.latitude, listing.longitude]} icon={priceIcon(formattedPrice)}>
      <Popup minWidth={200}>
        <Link href={`/listings/${listing.id}`} className="flex flex-col gap-2 no-underline">
          <div className="relative h-24 w-full overflow-hidden rounded-lg bg-surface-muted">
            {listing.photo && (
              <Image
                src={listing.photo}
                alt={listing.title}
                fill
                className="object-cover"
                sizes="200px"
                unoptimized={!isOptimizableImage(listing.photo)}
              />
            )}
          </div>
          <div>
            <p className="truncate text-sm font-semibold text-foreground">{listing.title}</p>
            <p className="text-xs text-stone-500">{listing.city}</p>
            <p className="mt-1 text-sm font-bold text-brand-800">
              {formattedPrice}
              <span className="text-xs font-normal text-stone-500"> / night</span>
            </p>
          </div>
        </Link>
      </Popup>
    </Marker>
  );
}

/**
 * Stays whose price pills would overlap at the current zoom, grouped into
 * one "N stays" pill (greedy, by on-screen distance - plenty for a coast's
 * worth of listings, no clustering library needed). Re-worked out on every
 * zoom or pan; tapping a group zooms in to it.
 */
const GROUP_RADIUS_PX = 56;

type Group = { key: string; listings: MapListing[]; latitude: number; longitude: number };

export function groupListings(
  listings: MapListing[],
  toPixel: (listing: MapListing) => { x: number; y: number },
  radius = GROUP_RADIUS_PX,
): Group[] {
  const groups: (Group & { x: number; y: number })[] = [];
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

function GroupMarker({ group }: { group: Group }) {
  const map = useMap();
  const fromPrice = useFormattedPrice(guestNightlyPriceCents(Math.min(...group.listings.map((l) => l.pricePerNightCents))));
  return (
    <Marker
      position={[group.latitude, group.longitude]}
      icon={priceIcon(`${group.listings.length} stays · from ${fromPrice}`)}
      title={`${group.listings.length} stays - zoom in to see them`}
      eventHandlers={{
        click: () => {
          const bounds = L.latLngBounds(group.listings.map((l) => [l.latitude, l.longitude] as [number, number]));
          const target = map.getBoundsZoom(bounds.pad(0.3));
          // Stays at (almost) the same spot: zoom in a couple of steps anyway.
          map.flyTo(bounds.getCenter(), Math.max(target, map.getZoom() + 2), { duration: 0.4 });
        },
      }}
    />
  );
}

function GroupedMarkers({ listings }: { listings: MapListing[] }) {
  const map = useMap();
  const work = () => groupListings(listings, (l) => map.latLngToContainerPoint([l.latitude, l.longitude]));
  const [groups, setGroups] = useState(work);
  useMapEvents({ zoomend: () => setGroups(work()), moveend: () => setGroups(work()) });
  return groups.map((group) =>
    group.listings.length === 1 ? (
      <ListingMarker key={group.key} listing={group.listings[0]} />
    ) : (
      <GroupMarker key={`group-${group.key}-${group.listings.length}`} group={group} />
    ),
  );
}

export function ListingsMapInner({ listings }: { listings: MapListing[] }) {
  const center =
    listings.length > 0
      ? { latitude: listings[0].latitude, longitude: listings[0].longitude }
      : fyldeCoastCenter();
  const bounds: [number, number][] = listings.map((l) => [l.latitude, l.longitude]);

  return (
    <MapContainer
      center={[center.latitude, center.longitude]}
      zoom={12}
      bounds={bounds.length > 1 ? bounds : undefined}
      boundsOptions={{ padding: [40, 40] }}
      scrollWheelZoom={false}
      className="h-[480px] w-full rounded-2xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {/* Keyed by the stays shown, so new filter results are grouped afresh. */}
      <GroupedMarkers key={listings.map((l) => l.id).join(",")} listings={listings} />
    </MapContainer>
  );
}
