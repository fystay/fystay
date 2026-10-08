import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({}));
vi.mock("leaflet", () => ({ default: {} }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("@/components/CurrencyProvider", () => ({ useFormattedPrice: () => "" }));

import { groupListings, type MapListing } from "./ListingsMapInner";

const listing = (id: string, x: number, y: number): MapListing & { x: number; y: number } => ({
  id,
  title: id,
  city: "Lytham",
  photo: null,
  pricePerNightCents: 10000,
  latitude: y,
  longitude: x,
  x,
  y,
});

describe("groupListings", () => {
  it("groups stays whose pills would overlap and leaves distant ones alone", () => {
    const stays = [listing("a", 0, 0), listing("b", 20, 10), listing("c", 300, 300), listing("d", 30, 0)];
    const groups = groupListings(stays, (l) => ({ x: l.longitude, y: l.latitude }));
    expect(groups.map((g) => g.listings.map((l) => l.id))).toEqual([["a", "b", "d"], ["c"]]);
    // A group sits at the middle of its stays.
    expect(groups[0].longitude).toBeCloseTo(50 / 3);
  });

  it("shows every stay on its own once they're far enough apart on screen", () => {
    const stays = [listing("a", 0, 0), listing("b", 100, 0), listing("c", 200, 0)];
    expect(groupListings(stays, (l) => ({ x: l.longitude, y: l.latitude }))).toHaveLength(3);
  });
});
