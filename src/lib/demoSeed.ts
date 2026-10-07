import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { computeBookingPricing } from "@/lib/pricing";
import { generateBookingReference } from "@/lib/bookingReference";
import { geocodeListing } from "@/lib/geocoding";
import { generateReferralCode } from "@/lib/referral";
import { todayStayDate } from "@/lib/stayDates";

/**
 * Shared by prisma/seed.ts (local `npm run db:seed`) and the admin-only
 * POST /api/admin/seed-demo-data route (for populating a real deployed
 * environment through the app's own DATABASE_URL, without anyone needing
 * a direct database connection) - one source of truth for the demo
 * dataset instead of two copies drifting apart.
 *
 * Every listing/review/provider write here is idempotent (checked by
 * title/email/name before creating), so calling this repeatedly - most
 * realistically via the admin route, more than once - never duplicates
 * data.
 */

// Every town has at least one real, licensed photo (self-hosted under
// public/ - the same "real, licensed media only" rule as the homepage hero
// video and DESTINATION_PHOTOS, which three of these reuse), used as the
// first photo of each demo listing in that town, ahead of the generated
// placeholder art below. A town with several photos hands them out in turn
// (see townCoverPhoto), so neighbouring cards don't all open on the same
// shot. Each photo is genuinely of its own town - the Lytham windmill is
// never reused for St Annes. This is demo-catalogue dressing, not real
// per-property photography, and gets replaced by host-uploaded photos.
const TOWN_COVER_PHOTOS: Partial<Record<string, string[]>> = {
  Blackpool: [
    "/images/destinations/blackpool-tile.jpg",
    "/images/destinations/blackpool-hero.jpg",
    "/images/listings/blackpool-pier.jpg",
  ],
  Fleetwood: ["/images/listings/fleetwood-cover.jpg"],
  Lytham: ["/images/destinations/lytham-st-annes.jpg"],
  "Poulton-le-Fylde": ["/images/listings/poulton-cover.jpg"],
  "St Annes": ["/images/listings/st-annes-cover.jpg"],
  "Thornton-Cleveleys": ["/images/destinations/cleveleys.jpg"],
};

// Covers this seed used to hand out, still recognised as its own so a re-run
// replaces them: the homepage hero's poster frame was a Blackpool cover until
// the hero changed, and listings repeating the hero's picture weakened it.
const RETIRED_TOWN_COVER_PHOTOS = ["/videos/hero-blackpool-pier-poster.jpg"];

const ALL_TOWN_COVER_PHOTOS = new Set([...Object.values(TOWN_COVER_PHOTOS).flat(), ...RETIRED_TOWN_COVER_PHOTOS]);

/** The cover for one demo listing: its town's photos in turn, by the listing's position among that town's demo listings. */
function townCoverPhoto(city: string, title: string): string | undefined {
  const covers = TOWN_COVER_PHOTOS[city];
  if (!covers?.length) return undefined;
  const sameTown = [...DEMO_LISTINGS, DEMO_HOTEL_LISTING]
    .filter((listing) => listing.city === city)
    .map((listing) => listing.title);
  return covers[Math.max(0, sameTown.indexOf(title)) % covers.length];
}

/** Whether a stored photo is one this seed generated (placeholder art or a town cover) - never a host's own upload. */
function isDemoSeedPhoto(photo: string): boolean {
  return photo.startsWith("data:image/svg+xml") || ALL_TOWN_COVER_PHOTOS.has(photo);
}

// The remaining photos ship as generated placeholder art instead of
// hotlinked stock photos: it renders instantly with zero external requests,
// so the demo never depends on a third-party image host being reachable.
// Every entry stays in the same warm terracotta/amber/rust/umber/wine
// family as the brand palette (globals.css) - no green or blue, which read
// as an off-brand cold contrast against the site's warm parchment background.
const PALETTES: [string, string][] = [
  ["#d97757", "#954328"],
  ["#f59e0b", "#b45309"],
  ["#c2622a", "#7a3a17"],
  ["#a34b4b", "#5c2323"],
  ["#8a5a3b", "#4a3220"],
];

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Line-art glyphs (24x24 viewBox, same stroke language as the lucide icons
// used everywhere else in the app) standing in for a property's photos.
// "house" reuses the brand mark itself for city apartments/lofts. The
// first four are each listing's own "exterior" signature (picked per
// listing below); the last four are generic room glyphs used to give a
// listing's later photos their own subject instead of repeating the
// exterior glyph on every tile - see ROOM_SEQUENCE and iconForPhotoIndex.
type PlaceholderIcon = "house" | "lighthouse" | "waves" | "star";
type RoomIcon = "sofa" | "bed" | "bath" | "window";
type IconKey = PlaceholderIcon | RoomIcon;

const ICON_PATHS: Record<IconKey, string[]> = {
  house: [
    "M3 11.5L12 4l9 7.5",
    "M5.5 10v9a1 1 0 0 0 1 1H17.5a1 1 0 0 0 1-1v-9",
  ],
  lighthouse: [
    "M9 21V10a3 3 0 0 1 3-3 3 3 0 0 1 3 3v11",
    "M9.5 14h5",
    "M7 21h10",
  ],
  waves: [
    "M2 9c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0",
    "M2 15c1.5 1.3 3 1.3 4.5 0s3-1.3 4.5 0 3 1.3 4.5 0 3-1.3 4.5 0",
  ],
  // The premium listings (see DEMO_LISTINGS below) - a distinct glyph so
  // they read as a different tier at a glance rather than just a higher
  // price tag on an otherwise identical card.
  star: [
    "M12 3l2.6 5.8 6.4.6-4.8 4.3 1.4 6.3L12 16.9 6.4 20l1.4-6.3-4.8-4.3 6.4-.6z",
  ],
  sofa: [
    "M4 17v-4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4",
    "M2 17h20",
    "M4 17v2",
    "M20 17v2",
    "M6 11V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3",
  ],
  bed: [
    "M4 19v-8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8",
    "M2 19h20",
    "M4 19v2",
    "M20 19v2",
    "M4 13h16",
    "M7 13V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4",
  ],
  bath: [
    "M3 12v4a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4",
    "M3 12h18",
    "M6 12V8a2 2 0 0 1 2-2h1",
    "M9 20v1",
    "M15 20v1",
  ],
  window: ["M4 4h16v16H4Z", "M4 12h16", "M12 4v16"],
};

// A listing's own exterior glyph (its placeholderIcon below) always opens
// the carousel; every photo after that cycles through these room glyphs
// instead of repeating the exterior on every tile, so a listing's four
// photos read as a short room tour rather than four re-tinted duplicates
// of the same icon.
const ROOM_SEQUENCE: RoomIcon[] = ["sofa", "bed", "bath", "window"];

function iconForPhotoIndex(exterior: PlaceholderIcon, index: number): IconKey {
  return index === 0 ? exterior : ROOM_SEQUENCE[(index - 1) % ROOM_SEQUENCE.length];
}

function iconMarkup(icon: IconKey, size: number, marginRight: number, marginBottom: number): string {
  const scale = size / 24;
  const tx = 1200 - marginRight - size;
  const ty = 900 - marginBottom - size;
  const paths = ICON_PATHS[icon].map((d) => `<path d="${d}" />`).join("");
  return `<g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="white" stroke-opacity="0.3" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}

// A believable coastal-light composition - a darker "sky" tone settling
// into the palette's warmer tone toward the bottom, the same top-dark/
// bottom-warm read as the homepage hero video's own scrim - rather than
// the flat corner-to-corner swatch this used to be. A soft radial vignette
// and a faint grain layer (a standard feTurbulence trick: the noise
// primitive generates its own pixels regardless of the rect's own fill,
// so its alpha channel becomes a subtle procedural texture) keep a large
// flat gradient from reading as an obviously-vector fill up close. The
// room glyph moves from a giant centered icon to a small, low-opacity
// corner mark - a watermark cue for "this is a placeholder", not the
// dominant thing in the frame.
function placeholderPhoto(seedText: string, index: number, exteriorIcon: PlaceholderIcon): string {
  const [from, to] = PALETTES[(hashCode(seedText) + index) % PALETTES.length];
  const icon = iconForPhotoIndex(exteriorIcon, index);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${to}"/>
        <stop offset="0.55" stop-color="${from}"/>
        <stop offset="1" stop-color="${from}" stop-opacity="0.88"/>
      </linearGradient>
      <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.75">
        <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.22"/>
      </radialGradient>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="noise"/>
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#sky)"/>
    <rect width="100%" height="100%" filter="url(#grain)"/>
    <rect width="100%" height="100%" fill="url(#vignette)"/>
    ${iconMarkup(icon, 108, 56, 56)}
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function placeholderPhotos(seedText: string, count: number, exteriorIcon: PlaceholderIcon): string[] {
  return Array.from({ length: count }, (_, i) => placeholderPhoto(seedText, i, exteriorIcon));
}

function listingPhotos(city: string, title: string, count: number, exteriorIcon: PlaceholderIcon): string[] {
  const cover = townCoverPhoto(city, title);
  if (!cover) return placeholderPhotos(city, count, exteriorIcon);
  return [cover, ...placeholderPhotos(city, count - 1, exteriorIcon)];
}

/**
 * Brings an already-seeded demo listing's cover up to date with
 * TOWN_COVER_PHOTOS, so a database seeded before a town had a real photo
 * picks it up on the next seed run. Only touches the demo host's listings,
 * and only when the current cover is itself seed-generated - a photo a
 * host uploaded is never replaced. Returns whether it changed anything.
 */
async function refreshDemoCoverPhoto(
  prisma: PrismaClient,
  listing: { id: string; hostId: string; city: string; title: string; photos: string[] },
  demoHostId: string,
): Promise<boolean> {
  const cover = townCoverPhoto(listing.city, listing.title);
  if (!cover || listing.hostId !== demoHostId) return false;
  const [current, ...rest] = listing.photos;
  if (current === cover || (current !== undefined && !isDemoSeedPhoto(current))) return false;
  await prisma.listing.update({ where: { id: listing.id }, data: { photos: [cover, ...rest] } });
  return true;
}

export const DEMO_LISTINGS = [
  {
    title: "Seafront apartment overlooking Blackpool promenade",
    description:
      "Wake up to sea views right on Blackpool's famous promenade. Two minutes from the beach, five from the Tower, with the tram stop just outside.",
    city: "Blackpool",
    country: "England",
    propertyType: "APARTMENT" as const,
    pricePerNightCents: 7500,
    maxGuests: 4,
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Sea view", "Free parking"],
    placeholderIcon: "waves" as const,
    cancellationPolicy: "FLEXIBLE" as const,
    lastMinuteDiscountPercent: 20,
    lastMinuteWindowDays: 7,
  },
  {
    title: "Elegant Victorian townhouse in Lytham",
    description:
      "A beautifully restored townhouse two streets back from Lytham Green. High ceilings, a walled garden, and a five-minute stroll to the shops and windmill.",
    city: "Lytham",
    country: "England",
    propertyType: "HOUSE" as const,
    pricePerNightCents: 14500,
    maxGuests: 6,
    bedrooms: 3,
    beds: 3,
    bathrooms: 2,
    amenities: ["Wifi", "Kitchen", "Garden", "Washer", "Free parking"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "STRICT" as const,
    monthlyDiscountPercent: 20,
  },
  {
    title: "Cosy cottage near Fleetwood Marina",
    description:
      "A snug fisherman's cottage a short walk from Fleetwood Marina and the historic lighthouses. Perfect for a quiet coastal break, with the Knott End ferry nearby.",
    city: "Fleetwood",
    country: "England",
    propertyType: "COTTAGE" as const,
    pricePerNightCents: 5800,
    maxGuests: 3,
    bedrooms: 1,
    beds: 2,
    bathrooms: 1,
    weeklyDiscountPercent: 15,
    amenities: ["Wifi", "Kitchen", "Washer", "Pet friendly"],
    placeholderIcon: "lighthouse" as const,
    cancellationPolicy: "CUSTOM" as const,
    // Demo price drop from £64 a night (see src/lib/deals.ts).
    priceDropFromCents: 6400,
    priceDroppedAt: new Date(),
    customCancellationCutoffDays: 10,
    customCancellationRefundPercent: 75,
  },
  {
    title: "Beachfront studio in Cleveleys",
    description:
      "A bright, compact studio right on Cleveleys' open seafront - wake up to the tide out the window and walk straight onto the beach. A short tram ride from Blackpool without the crowds.",
    city: "Thornton-Cleveleys",
    country: "England",
    propertyType: "STUDIO" as const,
    pricePerNightCents: 4200,
    maxGuests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Sea view"],
    placeholderIcon: "waves" as const,
    cancellationPolicy: "FLEXIBLE" as const,
    lastMinuteDiscountPercent: 15,
    lastMinuteWindowDays: 3,
  },
  {
    title: "Clifftop garden apartment in Bispham",
    description:
      "A quiet ground-floor apartment with its own garden, set back from Bispham's clifftop gardens and coastal views. Blackpool's attractions and Cleveleys' seafront are both a short drive away.",
    city: "Blackpool",
    country: "England",
    propertyType: "APARTMENT" as const,
    pricePerNightCents: 8900,
    maxGuests: 4,
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Garden", "Free parking"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "MODERATE" as const,
  },
  {
    title: "Premium sea-view penthouse on Blackpool promenade",
    description:
      "A top-floor penthouse with floor-to-ceiling sea views the entire length of Blackpool's promenade. Private hot tub terrace, hotel-grade linens and finishes throughout, and a five-minute walk to the Tower. The most complete stay FYStay currently lists in Blackpool.",
    city: "Blackpool",
    country: "England",
    propertyType: "APARTMENT" as const,
    pricePerNightCents: 32000,
    cleaningFeeCents: 6000,
    maxGuests: 6,
    bedrooms: 3,
    beds: 3,
    bathrooms: 2,
    amenities: [
      "Wifi",
      "Sea view",
      "Hot tub",
      "Free parking",
      "Air conditioning",
      "Kitchen",
      "Washer",
      "Balcony",
      "Elevator access",
    ],
    placeholderIcon: "star" as const,
    cancellationPolicy: "MODERATE" as const,
  },
  {
    title: "Signature villa with private pool near St Annes",
    description:
      "A gated four-bedroom villa moments from the town's famous golf links, built around a heated pool and private hot tub terrace. Interior-designed throughout, with a chef's kitchen and a walled garden made for evenings outside.",
    city: "St Annes",
    country: "England",
    propertyType: "VILLA" as const,
    pricePerNightCents: 39000,
    cleaningFeeCents: 9000,
    maxGuests: 8,
    bedrooms: 4,
    beds: 5,
    bathrooms: 3,
    amenities: [
      "Wifi",
      "Pool",
      "Hot tub",
      "Kitchen",
      "Garden",
      "Free parking",
      "Air conditioning",
      "Washer",
      "Dryer",
      "BBQ grill",
      "Fireplace",
    ],
    placeholderIcon: "star" as const,
    cancellationPolicy: "STRICT" as const,
  },
  {
    title: "Designer duplex overlooking Fleetwood Marina",
    description:
      "An architect-renovated two-storey duplex with full-height glass looking straight down Fleetwood Marina to the water. Private hot tub balcony, hotel-grade finishes, and lift access - a short stroll from the lighthouses and the Knott End ferry.",
    city: "Fleetwood",
    country: "England",
    propertyType: "APARTMENT" as const,
    pricePerNightCents: 21000,
    cleaningFeeCents: 5000,
    maxGuests: 5,
    bedrooms: 2,
    beds: 3,
    bathrooms: 2,
    amenities: [
      "Wifi",
      "Sea view",
      "Hot tub",
      "Kitchen",
      "Air conditioning",
      "Washer",
      "Balcony",
      "Elevator access",
      "Free parking",
    ],
    placeholderIcon: "star" as const,
    cancellationPolicy: "MODERATE" as const,
  },
  {
    title: "Family-run B&B room in Bispham",
    description:
      "A warm, traditionally furnished double room in a small family-run B&B two streets back from Bispham's clifftop gardens. Cooked breakfast included, with the tram stop and coastal path both a short walk away.",
    city: "Blackpool",
    country: "England",
    propertyType: "HOUSE" as const,
    pricePerNightCents: 6800,
    maxGuests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: ["Wifi", "Free parking", "Heating", "TV"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "MODERATE" as const,
  },
  {
    title: "Modern one-bed flat near Cleveleys tram stop",
    description:
      "A practical, recently refitted one-bedroom flat two minutes from the Cleveleys tram stop. No sea view, but everything you need for an easy, well-connected stay along the coast.",
    city: "Thornton-Cleveleys",
    country: "England",
    propertyType: "APARTMENT" as const,
    pricePerNightCents: 6200,
    maxGuests: 3,
    bedrooms: 1,
    beds: 2,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Washer", "Heating"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "FLEXIBLE" as const,
  },
  {
    title: "Garden cottage retreat in Lytham",
    description:
      "A single-storey cottage built around its own private garden, tucked down a quiet lane a short walk from Lytham Green. A peaceful, low-key base rather than a seafront address - ideal for a slower coastal break.",
    city: "Lytham",
    country: "England",
    propertyType: "COTTAGE" as const,
    pricePerNightCents: 9500,
    maxGuests: 4,
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Garden", "Free parking", "Pet friendly"],
    placeholderIcon: "lighthouse" as const,
    cancellationPolicy: "MODERATE" as const,
    weeklyDiscountPercent: 10,
  },
  {
    title: "Compact harbourside studio in Fleetwood",
    description:
      "A snug, well-priced studio overlooking Fleetwood's working harbour rather than the marina's newer apartments - a quieter, more local side of the town, five minutes from the Knott End ferry.",
    city: "Fleetwood",
    country: "England",
    propertyType: "STUDIO" as const,
    pricePerNightCents: 4800,
    maxGuests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Heating"],
    placeholderIcon: "waves" as const,
    cancellationPolicy: "FLEXIBLE" as const,
  },
  {
    title: "Townhouse two minutes from Poulton's market square",
    description:
      "A renovated townhouse two minutes' walk from the market cross and St Chad's Church. No sea view here, but the coast's best rail and bus connections are right on your doorstep - the beach is fifteen minutes away when you want it.",
    city: "Poulton-le-Fylde",
    country: "England",
    propertyType: "HOUSE" as const,
    pricePerNightCents: 9200,
    maxGuests: 4,
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Washer", "Free parking"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "MODERATE" as const,
  },
  {
    title: "Studio flat by Poulton-le-Fylde station",
    description:
      "A compact, well-priced studio two minutes from the railway station - the coast's own rail interchange. Handy for exploring Blackpool, Fleetwood and the whole Fylde Coast without needing a car.",
    city: "Poulton-le-Fylde",
    country: "England",
    propertyType: "STUDIO" as const,
    pricePerNightCents: 4600,
    maxGuests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Heating"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "FLEXIBLE" as const,
  },
  {
    title: "Georgian townhouse on St Annes' Square",
    description:
      "A tall Georgian townhouse two minutes from St Annes Square's cafes and independent shops, with the beach and pier a level ten-minute walk away. Traditionally furnished throughout, with a small south-facing courtyard garden.",
    city: "St Annes",
    country: "England",
    propertyType: "HOUSE" as const,
    pricePerNightCents: 11800,
    maxGuests: 5,
    bedrooms: 3,
    beds: 3,
    bathrooms: 2,
    amenities: ["Wifi", "Kitchen", "Garden", "Washer", "Free parking"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "MODERATE" as const,
  },
  {
    title: "Beach-hut style studio on St Annes seafront",
    description:
      "A cheerful, compact studio right on St Annes' quiet seafront, styled like a classic beach hut inside - all the promenade's calm without Blackpool's crowds, and the pier is a five-minute stroll along the sand.",
    city: "St Annes",
    country: "England",
    propertyType: "STUDIO" as const,
    pricePerNightCents: 5400,
    maxGuests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Sea view", "Heating"],
    placeholderIcon: "waves" as const,
    cancellationPolicy: "FLEXIBLE" as const,
  },
  {
    title: "Restored fisherman's cottage in Fleetwood's old town",
    description:
      "A two-up two-down cottage in Fleetwood's original fishing quarter, restored with a modern kitchen but its period features kept intact. Affinity Lancashire outlet centre and North Euston tram terminus are both a short walk away.",
    city: "Fleetwood",
    country: "England",
    propertyType: "COTTAGE" as const,
    pricePerNightCents: 7200,
    maxGuests: 4,
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Washer", "Heating", "Pet friendly"],
    placeholderIcon: "lighthouse" as const,
    cancellationPolicy: "MODERATE" as const,
  },
  {
    title: "Bay-view apartment on Thornton-Cleveleys promenade",
    description:
      "A generous two-bedroom apartment on the promenade looking straight out over Morecambe Bay to the Lake District fells. Blackpool's attractions are a short tram ride south; the quieter dunes at Rossall are right outside.",
    city: "Thornton-Cleveleys",
    country: "England",
    propertyType: "APARTMENT" as const,
    pricePerNightCents: 9800,
    maxGuests: 4,
    bedrooms: 2,
    beds: 2,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Sea view", "Free parking", "Balcony"],
    placeholderIcon: "waves" as const,
    cancellationPolicy: "FLEXIBLE" as const,
  },
  {
    title: "Coach house apartment moments from Lytham Green",
    description:
      "A characterful converted coach house tucked behind one of Lytham's period villas, moments from the Green, the windmill and the town's restaurants. Quieter than a seafront address, with private off-road parking.",
    city: "Lytham",
    country: "England",
    propertyType: "APARTMENT" as const,
    pricePerNightCents: 10400,
    maxGuests: 3,
    bedrooms: 1,
    beds: 2,
    bathrooms: 1,
    amenities: ["Wifi", "Kitchen", "Free parking", "Washer"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "MODERATE" as const,
  },
  {
    title: "Retro caravan-style lodge near Blackpool Pleasure Beach",
    description:
      "A playful, retro-styled lodge five minutes' walk from Pleasure Beach and the South Shore promenade - a fun, budget-friendly base for a classic Blackpool trip, with the tram and beach both on your doorstep.",
    city: "Blackpool",
    country: "England",
    propertyType: "STUDIO" as const,
    pricePerNightCents: 3900,
    maxGuests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    amenities: ["Wifi", "Heating", "TV"],
    placeholderIcon: "house" as const,
    cancellationPolicy: "FLEXIBLE" as const,
  },
];

// A HOTEL listing - deliberately kept separate from DEMO_LISTINGS above,
// since a HOTEL has no price/capacity of its own (RoomType does - see
// roomTypeAggregates.ts) and this needs its own room-type rows created
// alongside it, not just a flat Listing insert. Without at least one seeded
// hotel, the entire multi-room-type feature (search, booking, change
// requests - see isRoomTypeRangeAvailable and its callers) is never
// actually exercised by anyone browsing the seeded catalogue, which is
// also literally the first word of the site's own "Hotels · B&Bs ·
// Apartments" tagline.
export const DEMO_HOTEL_LISTING = {
  title: "The Promenade Hotel, Blackpool",
  description:
    "A traditional seafront hotel two minutes' walk from Blackpool Tower, with a choice of room types from a cosy standard double to a sea-view suite. Staffed reception, lift to every floor, and breakfast included.",
  city: "Blackpool",
  country: "England",
  propertyType: "HOTEL" as const,
  amenities: ["Wifi", "Breakfast included", "24-hour reception", "Lift", "Sea view"],
  placeholderIcon: "house" as const,
  cancellationPolicy: "MODERATE" as const,
  roomTypes: [
    {
      name: "Standard Double",
      description:
        "A comfortable double room with an en-suite shower, a short walk from the seafront.",
      pricePerNightCents: 6900,
      maxGuests: 2,
      bedrooms: 1,
      beds: 1,
      bathrooms: 1,
      totalRooms: 6,
      photos: [] as string[],
    },
    {
      name: "Deluxe Sea View Suite",
      description:
        "A larger suite with a private sea-view balcony and a super-king bed, sleeping up to four.",
      pricePerNightCents: 12900,
      maxGuests: 4,
      bedrooms: 1,
      beds: 2,
      bathrooms: 1,
      totalRooms: 2,
      photos: [] as string[],
    },
  ],
};

export type SeedDemoDataSummary = {
  hostEmail: string;
  guestEmail: string;
  listingsCreated: number;
  listingsSkippedExisting: number;
  listingPhotosRefreshed: number;
  reviewsCreated: number;
  demoBookingsCreated: number;
  extrasProvidersUpserted: number;
};

export async function seedDemoData(prisma: PrismaClient): Promise<SeedDemoDataSummary> {
  const hostPassword = await bcrypt.hash("hostpass123", 10);
  const guestPassword = await bcrypt.hash("guestpass123", 10);

  const host = await prisma.user.upsert({
    where: { email: "host@fystay.dev" },
    update: {},
    create: {
      name: "Alex Host",
      email: "host@fystay.dev",
      passwordHash: hostPassword,
      role: "HOST",
      referralCode: generateReferralCode(),
    },
  });

  const guest = await prisma.user.upsert({
    where: { email: "guest@fystay.dev" },
    update: {},
    create: {
      name: "Jamie Guest",
      email: "guest@fystay.dev",
      passwordHash: guestPassword,
      role: "GUEST",
      referralCode: generateReferralCode(),
    },
  });

  const createdListings = [];
  const newlyCreatedTitles = new Set<string>();
  let listingsCreated = 0;
  let listingsSkippedExisting = 0;
  let listingPhotosRefreshed = 0;

  for (const { placeholderIcon, ...listing } of DEMO_LISTINGS) {
    const existing = await prisma.listing.findFirst({ where: { title: listing.title } });
    if (existing) {
      createdListings.push(existing);
      listingsSkippedExisting++;
      if (await refreshDemoCoverPhoto(prisma, existing, host.id)) listingPhotosRefreshed++;
      continue;
    }

    const created = await prisma.listing.create({
      data: {
        ...listing,
        photos: listingPhotos(listing.city, listing.title, 4, placeholderIcon),
        hostId: host.id,
      },
    });
    const coordinates = geocodeListing({ id: created.id, city: created.city });
    const withCoordinates = coordinates
      ? await prisma.listing.update({ where: { id: created.id }, data: coordinates })
      : created;
    createdListings.push(withCoordinates);
    newlyCreatedTitles.add(listing.title);
    listingsCreated++;
  }

  // The one HOTEL listing, seeded separately from the loop above since it
  // needs RoomType rows created alongside it and its own price/capacity
  // fields derived from them (see recomputeListingAggregatesFromRoomTypes),
  // rather than a flat Listing insert.
  const existingHotel = await prisma.listing.findFirst({
    where: { title: DEMO_HOTEL_LISTING.title },
  });
  if (existingHotel) {
    createdListings.push(existingHotel);
    listingsSkippedExisting++;
    if (await refreshDemoCoverPhoto(prisma, existingHotel, host.id)) listingPhotosRefreshed++;
  } else {
    const { roomTypes, placeholderIcon, ...hotelListing } = DEMO_HOTEL_LISTING;
    const createdHotel = await prisma.listing.create({
      data: {
        ...hotelListing,
        pricePerNightCents: Math.min(...roomTypes.map((rt) => rt.pricePerNightCents)),
        maxGuests: Math.max(...roomTypes.map((rt) => rt.maxGuests)),
        bedrooms: Math.max(...roomTypes.map((rt) => rt.bedrooms)),
        beds: Math.max(...roomTypes.map((rt) => rt.beds)),
        bathrooms: Math.max(...roomTypes.map((rt) => rt.bathrooms)),
        photos: listingPhotos(hotelListing.city, hotelListing.title, 4, placeholderIcon),
        hostId: host.id,
      },
    });
    await prisma.roomType.createMany({
      data: roomTypes.map((rt) => ({ ...rt, listingId: createdHotel.id })),
    });
    const coordinates = geocodeListing({ id: createdHotel.id, city: createdHotel.city });
    const withCoordinates = coordinates
      ? await prisma.listing.update({ where: { id: createdHotel.id }, data: coordinates })
      : createdHotel;
    createdListings.push(withCoordinates);
    newlyCreatedTitles.add(DEMO_HOTEL_LISTING.title);
    listingsCreated++;
  }

  // A completed stay + review for each of these listings, so the reviews
  // feature has something to show without needing a real guest to
  // complete a real stay first - covers the original everyday listing
  // plus all three premium ones, so "premium" also means "proven" rather
  // than showing no rating at all everywhere ratings are surfaced (search
  // sort, the homepage carousels, each listing's own detail page). Only
  // added for a listing this call actually created - otherwise a second
  // run of this same seed would keep stacking duplicate reviews onto
  // listings that already have one.
  const REVIEW_SEEDS = [
    {
      title: "Seafront apartment overlooking Blackpool promenade",
      checkInDaysAgo: 20,
      nights: 3,
      guests: 2,
      valueRating: 4,
      comment:
        "Wonderful stay right by the seafront. Spotless, comfortable, and the host was brilliant. Would book again in a heartbeat.",
    },
    {
      title: "Premium sea-view penthouse on Blackpool promenade",
      checkInDaysAgo: 12,
      nights: 3,
      guests: 4,
      valueRating: 5,
      comment:
        "Genuinely the best stay we've had on the Fylde Coast - the hot tub terrace at sunset looking over the sea was unreal, and everything felt hotel-grade. Worth every penny.",
    },
    {
      title: "Signature villa with private pool near St Annes",
      checkInDaysAgo: 8,
      nights: 4,
      guests: 6,
      valueRating: 5,
      comment:
        "Booked this for a big family week and it completely delivered - the pool and hot tub got used every single day, and the kitchen is better equipped than most restaurants. Faultless.",
    },
    {
      title: "Designer duplex overlooking Fleetwood Marina",
      checkInDaysAgo: 15,
      nights: 2,
      guests: 4,
      valueRating: 5,
      comment:
        "Stunning finish throughout and that marina view over the hot tub at dusk was worth the whole trip on its own. Felt like a boutique hotel, not a rental.",
    },
  ] as const;

  let reviewsCreated = 0;
  for (const seed of REVIEW_SEEDS) {
    const reviewedListing = createdListings.find((l) => l.title === seed.title);
    if (!reviewedListing || !newlyCreatedTitles.has(reviewedListing.title)) continue;

    // Stay dates are UTC midnights (see src/lib/stayDates.ts).
    const checkIn = new Date(todayStayDate().getTime() - seed.checkInDaysAgo * 24 * 60 * 60 * 1000);
    const checkOut = new Date(checkIn.getTime() + seed.nights * 24 * 60 * 60 * 1000);
    const pricing = computeBookingPricing({
      nights: seed.nights,
      pricePerNightCents: reviewedListing.pricePerNightCents,
      cleaningFeeCents: reviewedListing.cleaningFeeCents,
    });
    const booking = await prisma.booking.create({
      data: {
        reference: generateBookingReference(),
        listingId: reviewedListing.id,
        guestId: guest.id,
        checkIn,
        checkOut,
        guests: seed.guests,
        nights: seed.nights,
        nightlyPriceCents: reviewedListing.pricePerNightCents,
        cleaningFeeCents: pricing.cleaningFeeCents,
        serviceFeeCents: pricing.serviceFeeCents,
        taxCents: pricing.taxCents,
        totalPriceCents: pricing.totalPriceCents,
        status: "COMPLETED",
        paymentStatus: "PAID",
        paidAt: checkIn,
        guestName: guest.name,
        guestEmail: guest.email,
      },
    });
    await prisma.review.create({
      data: {
        bookingId: booking.id,
        listingId: reviewedListing.id,
        authorId: guest.id,
        rating: 5,
        cleanlinessRating: 5,
        accuracyRating: 5,
        communicationRating: 5,
        locationRating: 5,
        valueRating: seed.valueRating,
        comment: seed.comment,
      },
    });
    reviewsCreated++;
  }

  const demoBookingsCreated = await seedDemoHostActivity(prisma, {
    hostId: host.id,
    guestId: guest.id,
    guestEmail: guest.email,
    reservedTitles: new Set<string>([...REVIEW_SEEDS.map((r) => r.title), DEMO_HOTEL_LISTING.title]),
  });

  // Trip extras (see docs/trip-extras-roadmap.md): EV Exec is FYStay's own
  // transfer business and the first extras provider. The notification
  // email is read from an env var (with a placeholder fallback) rather
  // than hardcoded, since a real deployment needs booking requests
  // actually landing in EV Exec's real inbox, not a seeded placeholder.
  const evExec = await prisma.extraProvider.upsert({
    where: { name: "EV Exec" },
    update: {},
    create: {
      name: "EV Exec",
      category: "AIRPORT_TRANSFER",
      notificationEmail: process.env.EV_EXEC_NOTIFICATION_EMAIL ?? "bookings@evexec.example",
      bookingFormUrl: process.env.EV_EXEC_BOOKING_FORM_URL ?? null,
    },
  });
  const evExecFeatures = ["Tesla / fully electric", "Fixed pricing", "Meet & greet"];
  await prisma.extraOffering.upsert({
    where: { providerId_name: { providerId: evExec.id, name: "Return airport transfer" } },
    // update (not just create) so re-seeding an existing database picks up
    // the marketing bullets shown across the cross-sell surfaces (homepage,
    // property page, booking flow, confirmation, account) - without this,
    // an already-seeded EV Exec offering would keep an empty features[].
    update: { features: evExecFeatures },
    create: {
      providerId: evExec.id,
      name: "Return airport transfer",
      description:
        "Door-to-door executive transfer between the airport and your stay, both ways - booked and confirmed by EV Exec.",
      category: "AIRPORT_TRANSFER",
      priceCents: 4500,
      features: evExecFeatures,
    },
  });

  // Phase 2 of the roadmap (docs/trip-extras-roadmap.md) - broadening past
  // EV Exec into the other categories the user named (attraction tickets,
  // car hire). Deliberately seeded under generic placeholder business
  // names rather than a real named local company - FYStay has no
  // confirmed commercial partnership or booking arrangement with any real
  // attraction/car-hire company yet, and seeding one under a real
  // company's name would misrepresent an affiliation that doesn't exist.
  // Once a real partner is signed, rename/replace these via /admin/extras
  // rather than this seed.
  //
  // Seeded inactive (active: false, create-only - a reseed never flips an
  // admin's own reactivation back off) because notificationEmail is a
  // guaranteed-bouncing @fystay.invalid address: if a guest ever paid for
  // one of these before a real partner and real email replaced it, nobody
  // - not the "provider", not FYStay support - would ever be notified of
  // the purchase. Reactivate from /admin/extras once both are real.
  const attractionsProvider = await prisma.extraProvider.upsert({
    where: { name: "Fylde Coast Attractions (placeholder)" },
    update: {},
    create: {
      name: "Fylde Coast Attractions (placeholder)",
      category: "ATTRACTION_TICKET",
      notificationEmail: "placeholder-attractions@fystay.invalid",
      active: false,
    },
  });
  await prisma.extraOffering.upsert({
    where: {
      providerId_name: {
        providerId: attractionsProvider.id,
        name: "Blackpool day attraction pass",
      },
    },
    update: {},
    create: {
      providerId: attractionsProvider.id,
      name: "Blackpool day attraction pass",
      description: "One day's entry to a local Blackpool-area attraction - confirmed after booking.",
      category: "ATTRACTION_TICKET",
      priceCents: 3500,
    },
  });

  // Same reasoning as attractionsProvider above - inactive until a real
  // partner and real notification email replace this placeholder.
  const carHireProvider = await prisma.extraProvider.upsert({
    where: { name: "Fylde Coast Car Hire (placeholder)" },
    update: {},
    create: {
      name: "Fylde Coast Car Hire (placeholder)",
      category: "CAR_HIRE",
      notificationEmail: "placeholder-carhire@fystay.invalid",
      active: false,
    },
  });
  await prisma.extraOffering.upsert({
    where: { providerId_name: { providerId: carHireProvider.id, name: "3-day car hire" } },
    update: {},
    create: {
      providerId: carHireProvider.id,
      name: "3-day car hire",
      description: "A compact hire car for the length of your stay, collected locally.",
      category: "CAR_HIRE",
      priceCents: 9000,
    },
  });

  // Hotel affiliate marketplace (src/lib/hotelProviders/) - the "mock"
  // HotelProvider row is what src/lib/hotelProviders/search.ts reads to
  // decide which provider(s) to query, exactly the same "read ACTIVE rows
  // from the database" path a real Booking.com row will use once one
  // exists. Seeded ACTIVE here (dev/test data only, never real inventory)
  // so hotel search has something to query out of the box; deliberately
  // NOT seeding a "booking_com" row - see src/lib/hotelProviders/providers/
  // bookingCom.ts's own comment for why that stays unconfigured until real
  // partner credentials exist.
  await prisma.hotelProvider.upsert({
    where: { code: "mock" },
    update: {},
    create: {
      code: "mock",
      name: "Mock provider (dev/test only)",
      status: "ACTIVE",
      supportsSearch: true,
      supportsDeepLink: true,
      supportsClickTracking: true,
      supportsConversionTracking: false,
    },
  });

  return {
    hostEmail: host.email,
    guestEmail: guest.email,
    listingsCreated,
    listingsSkippedExisting,
    listingPhotosRefreshed,
    reviewsCreated,
    demoBookingsCreated,
    extrasProvidersUpserted: 3,
  };
}

// Made-up names for the demo host's guests - ordinary combinations, not
// anyone in particular.
const DEMO_GUEST_NAMES = [
  "Priya Shah",
  "Tom Walsh",
  "Megan Doyle",
  "Callum Price",
  "Aisha Rahman",
  "Ellie Fielding",
  "Daniel Okafor",
  "Hannah Brooks",
  "Owen Pritchard",
  "Grace Lindley",
  "Marcus Bell",
  "Zoe Hartley",
];

const DEMO_REFERENCE_PREFIX = "DEMO-";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A believable year of hosting for the demo host, so the hosting pages
 * (Today, Bookings, Calendar, Earnings) show what they're for: past stays
 * across the last eleven months (busier in summer), guests in residence
 * today, an arrival and a departure today, the next few weeks booked, one
 * request awaiting a reply and one part-refunded cancellation. Half the
 * listings also get their check-in details and house rules, so the
 * listing-quality checklist shows a realistic mix.
 *
 * Runs once: skipped when any DEMO- booking already exists. Leaves out the
 * listings with seeded reviews (their stays are already placed) and the
 * hotel (room-type bookings), so no two stays here overlap.
 */
async function seedDemoHostActivity(
  prisma: PrismaClient,
  ctx: { hostId: string; guestId: string; guestEmail: string; reservedTitles: Set<string> },
): Promise<number> {
  if ((await prisma.booking.count({ where: { reference: { startsWith: DEMO_REFERENCE_PREFIX } } })) > 0) return 0;

  const listings = (
    await prisma.listing.findMany({ where: { hostId: ctx.hostId }, orderBy: { title: "asc" } })
  ).filter((l) => !ctx.reservedTitles.has(l.title));
  if (listings.length < 12) return 0;

  for (const [i, listing] of listings.entries()) {
    if (i % 2 === 1) continue;
    await prisma.listing.update({
      where: { id: listing.id },
      data: {
        checkInTime: listing.checkInTime ?? "From 3pm",
        checkOutTime: listing.checkOutTime ?? "By 10am",
        checkInInstructions:
          listing.checkInInstructions ?? "Self check-in with a key safe by the front door - the code is sent the day before.",
        additionalRules: listing.additionalRules ?? "No smoking indoors. Please keep noise down after 10pm.",
      },
    });
  }

  const today = todayStayDate();
  let created = 0;
  let n = 0;
  const book = async (
    listing: (typeof listings)[number],
    checkIn: Date,
    nights: number,
    guests: number,
    state: "COMPLETED" | "CONFIRMED" | "REQUEST" | "CANCELLED",
  ) => {
    const pricing = computeBookingPricing({
      nights,
      pricePerNightCents: listing.pricePerNightCents,
      cleaningFeeCents: listing.cleaningFeeCents,
    });
    const paid = state !== "REQUEST";
    const paidAt = paid ? new Date(Math.min(checkIn.getTime() - 14 * DAY_MS, Date.now() - DAY_MS)) : null;
    n += 1;
    await prisma.booking.create({
      data: {
        reference: `${DEMO_REFERENCE_PREFIX}${String(n).padStart(3, "0")}`,
        listingId: listing.id,
        guestId: ctx.guestId,
        checkIn,
        checkOut: new Date(checkIn.getTime() + nights * DAY_MS),
        guests: Math.min(guests, listing.maxGuests),
        nights,
        nightlyPriceCents: listing.pricePerNightCents,
        cleaningFeeCents: pricing.cleaningFeeCents,
        serviceFeeCents: pricing.serviceFeeCents,
        taxCents: pricing.taxCents,
        totalPriceCents: pricing.totalPriceCents,
        status: state === "REQUEST" ? "PENDING" : state,
        paymentStatus: state === "CANCELLED" ? "PARTIALLY_REFUNDED" : paid ? "PAID" : "UNPAID",
        paidAt,
        createdAt: paidAt ? new Date(paidAt.getTime() - 10 * 60 * 1000) : new Date(Date.now() - 2 * 60 * 60 * 1000),
        ...(state === "REQUEST" && {
          approvalStatus: "AWAITING" as const,
          requestExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000),
        }),
        ...(state === "CANCELLED" && {
          refundedAmountCents: Math.round(pricing.totalPriceCents / 2),
          refundedAt: new Date(),
        }),
        guestName: DEMO_GUEST_NAMES[n % DEMO_GUEST_NAMES.length],
        guestEmail: ctx.guestEmail,
      },
    });
    created += 1;
  };

  // Past months: each month's stays on different listings, so none overlap.
  // Busiest in summer, like the real Fylde Coast (index = calendar month).
  const perCalendarMonth = [2, 2, 3, 4, 5, 7, 9, 9, 6, 4, 3, 3];
  for (let monthsAgo = 11; monthsAgo >= 1; monthsAgo--) {
    const count = perCalendarMonth[(today.getUTCMonth() - monthsAgo + 12) % 12];
    for (let k = 0; k < count; k++) {
      const listing = listings[(k * 5 + monthsAgo) % listings.length];
      const checkIn = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 2 + ((k * 4) % 20)));
      await book(listing, checkIn, 2 + ((k + monthsAgo) % 4), 2 + (k % 3), "COMPLETED");
    }
  }

  // Around today, one listing each.
  const at = (days: number) => new Date(today.getTime() + days * DAY_MS);
  await book(listings[0], at(-2), 4, 2, "CONFIRMED"); // staying
  await book(listings[1], at(-1), 3, 3, "CONFIRMED"); // staying
  await book(listings[2], at(0), 3, 2, "CONFIRMED"); // arriving today
  await book(listings[3], at(-3), 3, 2, "CONFIRMED"); // leaving today
  await book(listings[4], at(2), 2, 2, "CONFIRMED");
  await book(listings[5], at(4), 5, 4, "CONFIRMED");
  await book(listings[6], at(6), 3, 2, "CONFIRMED");
  await book(listings[7], at(9), 2, 2, "CONFIRMED");
  await book(listings[8], at(12), 7, 3, "CONFIRMED");
  await book(listings[9], at(20), 3, 2, "CONFIRMED");
  await book(listings[0], at(35), 4, 2, "CONFIRMED");
  await book(listings[10], at(15), 3, 2, "REQUEST");
  await book(listings[11], at(25), 3, 2, "CANCELLED");

  return created;
}
