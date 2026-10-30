/**
 * What a bespoke listing page (ListingShowcase) is made of. Every part but
 * the basics is optional, so a listing with only its photos and description
 * still gets a good page and one a host (or FYStay, writing it with them)
 * has put care into gets a richer one.
 */
export type ShowcasePhoto = {
  src: string;
  alt: string;
  /** A short label shown over the photo, e.g. "The lounge". */
  label?: string;
  /** Where the photo is anchored when cropped to fill the hero, as a Tailwind class, e.g. "object-[50%_30%]". */
  position?: string;
};

export type ShowcaseContent = {
  title: string;
  /** Where it is, as a guest would say it. */
  place: string;
  /** The page's headline: `accent` is picked out in the brand colour. */
  headline: { before: string; accent: string; after: string };
  intro: string;
  /** The one photo behind the headline: the sharpest, widest the property has. */
  hero: ShowcasePhoto;
  /** The photos a phone opens on: a few of the best, each labelled, swiped through. */
  carousel: ShowcasePhoto[];
  /** Every photo in display order; the first few sit under the hero, the rest open from "View all". */
  gallery: ShowcasePhoto[];
  facts: { label: string; value: string }[];
    sleeping?: { kicker: string; title: string; rooms: { name: string; beds: string; photo: ShowcasePhoto }[] };
  afterDark?: { kicker: string; title: string; body: string; photos: ShowcasePhoto[] };
  setting?: { kicker: string; title: string; points: { title: string; body: string }[] };
  amenities: string[];
  /** Plain-English terms a guest should see before choosing dates. */
  goodToKnow: string[];
  /** Who looks after it, in the host's own words. */
  hostNote: string;
  price: { fromCents: number; weekendCents?: number; minNights: number; cancellation: string };
};
