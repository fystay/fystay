import { PROPERTY_TYPE_LABEL } from "@/lib/propertyType";
import type { ShowcaseContent, ShowcasePhoto } from "@/lib/showcase/types";
import type { PropertyType } from "@prisma/client";

/** Up to this many photos open the phone's swipeable hero; the rest are one tap away in the gallery. */
const CAROUSEL_PHOTOS = 6;

type ListingForShowcase = {
  id: string;
  title: string;
  description: string;
  city: string;
  country: string;
  propertyType: PropertyType;
  photos: string[];
  pricePerNightCents: number;
  weekendPricePerNightCents: number | null;
  minNights: number;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
};

/** The first sentence of the host's description, kept short enough to sit under a photo. */
export function taglineFrom(description: string, max = 110): string {
  const flat = description.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[,;:\s-]+$/, "")}…`;
}


/**
 * The page's content for any listing, from what the host has already given:
 * the photos (the first is the hero, the rest the gallery), the name, the
 * place, the first line of the description as a tagline, and the facts.
 * Hosts with more to say (bedrooms, an evening section) get a richer page by
 * adding to this; a listing with nothing extra still gets a good one.
 */
export function showcaseFromListing(listing: ListingForShowcase): ShowcaseContent {
  const photoAt = (src: string, i: number): ShowcasePhoto => ({ src, alt: `${listing.title} - photo ${i + 1}` });
  const gallery = listing.photos.map(photoAt);
  return {
    title: listing.title,
    place: `${PROPERTY_TYPE_LABEL[listing.propertyType]} · ${listing.city}, ${listing.country}`,
    headline: { before: taglineFrom(listing.description) || listing.title, accent: "", after: "" },
    intro: "",
    hero: gallery[0],
    carousel: gallery.slice(0, CAROUSEL_PHOTOS),
    gallery,
    facts: [
      { label: "Sleeps", value: `${listing.maxGuests}`, icon: "users" },
      { label: "Bedrooms", value: `${listing.bedrooms}`, icon: "door" },
      { label: "Bathrooms", value: `${listing.bathrooms}`, icon: "bath" },
      { label: "Beds", value: `${listing.beds}`, icon: "bed" },
    ],
    amenities: [],
    goodToKnow: [],
    hostNote: "",
    price: {
      fromCents: listing.pricePerNightCents,
      weekendCents: listing.weekendPricePerNightCents ?? undefined,
      minNights: listing.minNights,
      cancellation: "",
    },
  };
}

