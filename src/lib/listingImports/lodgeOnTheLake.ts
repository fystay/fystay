import type { CreateListingInput } from "@/lib/listingInput";

/**
 * Lodge on the Lake - a real, owner-supplied property added to FYStay
 * through the same create-listing rules a host's own form uses (see
 * scripts/listings/import-lodge-on-the-lake.ts, which uploads the photos
 * and writes the row). After the import the listing belongs to its host
 * like any other and is edited in the host dashboard; this file is not
 * re-read by the running site.
 *
 * Sources (checked 9-10 Oct 2026): the property's own site
 * (lsllodge.vercel.app, repo fystay/lsl-lodge, whose
 * docs/property-facts-and-policies.md records where each fact came from)
 * and the owner's Airbnb listing (rooms/49558875), used only to cross-check
 * facts - none of its copy, ratings or reviews are reused.
 *
 * The business terms (LODGE_ON_THE_LAKE_OWNER_TERMS) are the owner's, given
 * on 10 Oct 2026. Deliberately absent, because no source states them and
 * FYStay never fills a guess in for a host: cleaning fee, damage deposit,
 * check-in/out times, pets, accessibility and the lodge's street address -
 * unset, so they simply don't render.
 */

export const LODGE_ON_THE_LAKE_TITLE = "Lodge on the Lake | 3-Bedroom Lakeside Retreat";

/**
 * The village's postal town (Dock Acres, Borwick Lane, Carnforth LA6 1BH).
 * Not "Warton": the village is in Borwick, a few miles from Warton village,
 * and FYStay's Fylde Coast audience also knows a different Warton near
 * Lytham. Carnforth isn't one of the mapped Fylde Coast towns, so the
 * listing gets no map pin (geocodeListing never guesses one) - it shows in
 * the map view's "outside the mapped towns" list instead.
 */
export const LODGE_ON_THE_LAKE_CITY = "Carnforth";

export const LODGE_ON_THE_LAKE_DESCRIPTION = `Lodge on the Lake is a three-bedroom holiday lodge on a small lake within South Lakeland Leisure Village, near Carnforth and Warton in North Lancashire, set back from the village's main road. It sleeps up to six, which makes it an easy fit for a family or a small group looking for somewhere quiet between the southern Lake District, the Yorkshire Dales and the Morecambe Bay coast.

Inside, the open-plan living and dining room is arranged around an electric feature fireplace, and patio doors open straight out onto the decking. The kitchen is built around a central island with bar stools, with a separate utility room alongside.

There are three bedrooms: two with king-size beds and a twin room with two single beds, plus two bathrooms.

Outside, the lodge's private decking looks out over the water, with seating for slow breakfasts and long evenings. There's parking for two cars.

The leisure village
South Lakeland Leisure Village has a pool, gym and spa, and an on-site bar and restaurant. Leisure passes are not included in the price of your stay: they're bought by the day or the week at the leisure centre, and facilities are subject to availability. Fishing is available on the village's lakes, subject to the village's rules, and you'll need a valid rod licence.

Getting out
The southern Lake District, the Yorkshire Dales and the Morecambe Bay coastline are all within driving distance, with the Yorkshire Dales National Park about an hour away by car. The lodge itself is not inside either national park.`;

/**
 * Free-text, like every host's amenities. Only features of the lodge itself
 * that a source states or a photo plainly shows - the village's pool, gym
 * and spa are paid, separate facilities, so they stay in the description
 * and out of this list (where they would match the Pool/Gym search
 * filters as if they came with the stay). Airbnb's "Waterfront" tag is
 * left out until the owner confirms that wording.
 */
export const LODGE_ON_THE_LAKE_AMENITIES = [
  "Wifi",
  "Kitchen",
  "Lake view",
  "Private decking overlooking the lake",
  "Parking for 2 cars",
  "Electric feature fireplace",
  "TV",
  "Dedicated workspace",
  "Utility room",
];

export const LODGE_ON_THE_LAKE_ADDITIONAL_RULES =
  "No stag or hen parties. Leisure passes for the village's pool, gym and spa are not included in the price of your stay and are bought separately at the leisure centre.";

/**
 * The gallery, in display order (the first is the search-card cover). From
 * the 21 photos the owner supplied in October 2026, with permission to use
 * them on FYStay confirmed on 10 Oct 2026; omitted are two living-room shots of what may be an older
 * layout and two decorative close-ups. FYStay stores photo URLs only, so
 * this alt text is kept here as the record for when per-photo alt text is
 * supported - the gallery currently labels photos "<title> photo N".
 */
export const LODGE_ON_THE_LAKE_PHOTOS: { file: string; alt: string }[] = [
  { file: "01-lodge-across-water.jpg", alt: "The lodge seen across the water on a sunny day, its decking and outdoor seating reflected in the lake" },
  { file: "02-deck-view-fountain.jpg", alt: "Wicker chairs and a glass-topped table on the decking, looking over a glass balustrade to the lake and its fountain" },
  { file: "03-living-room-media-wall.jpg", alt: "Living room with a grey sofa facing a wall-mounted television above a long electric fire, and a dining table by the patio doors" },
  { file: "04-media-wall-fire.jpg", alt: "Media wall with a television above a wide electric fire, framed by lit shelves and slatted wood panels" },
  { file: "05-kitchen-island.jpg", alt: "Kitchen island with open shelving and grey bar stools, white cabinets and a built-in oven" },
  { file: "06-kitchen.jpg", alt: "Kitchen with white cabinets, oven and microwave, an island with two bar stools, and patio doors" },
  { file: "07-main-bedroom.jpg", alt: "Main bedroom with white bedding, a grey throw and three framed peony prints above the bed" },
  { file: "08-main-bedroom-art.jpg", alt: "The main bed dressed with pink velvet cushions beneath peony prints, with bedside lamps either side" },
  { file: "09-second-bedroom.jpg", alt: "Second bedroom with a tall grey upholstered headboard, blue and grey cushions and matching bedside lamps" },
  { file: "10-second-bedroom-detail.jpg", alt: "The second bed with peacock-print cushions" },
  { file: "11-twin-bedroom.jpg", alt: "Twin bedroom with two single beds either side of a bedside table" },
  { file: "12-bathroom.jpg", alt: "Bathroom with a basin in a wood-effect vanity and a large mirror with shelving" },
  { file: "13-walk-in-wardrobe.jpg", alt: "Walk-in wardrobe with a hanging rail, shelving, drawers and a mirror" },
  { file: "14-utility-room.jpg", alt: "Utility room with a second sink and white cupboards" },
  { file: "15-lodge-and-neighbours.jpg", alt: "Wide view of the lodge among its neighbours, behind a lawn at the water's edge under a blue sky" },
  { file: "16-deck-evening.jpg", alt: "The decking at dusk, lit by post lights, with potted flowers and the lit windows of lodges across the water" },
  { file: "17-deck-gazebo-evening.jpg", alt: "A covered seating area on the decking after dark, lit by small deck lights" },
];

/** What only the owner can decide - never filled in by a schema default. */
export type OwnerTerms = {
  pricePerNightCents: number;
  /** Friday and Saturday nights. */
  weekendPricePerNightCents: number;
  minNights: number;
  cancellationPolicy: "FLEXIBLE" | "MODERATE" | "STRICT" | "NON_REFUNDABLE";
  smokingAllowed: boolean;
  partiesAllowed: boolean;
};

/**
 * The owner's terms, given 10 Oct 2026: £255 a night Sunday-Thursday and
 * £275 on Friday and Saturday nights, two nights minimum, "can cancel
 * within 24 hours of booking, after that no cancellation" (FYStay's
 * Non-refundable policy, whose 24 hours run from payment because this is a
 * request-to-book listing), and no smoking. Parties: the owner pointed to
 * the Airbnb listing, which bars stag and hen groups (Airbnb also bans
 * parties and events platform-wide), so no parties or events, with the
 * stag/hen rule spelled out in LODGE_ON_THE_LAKE_ADDITIONAL_RULES.
 */
export const LODGE_ON_THE_LAKE_OWNER_TERMS: OwnerTerms = {
  pricePerNightCents: 25_500,
  weekendPricePerNightCents: 27_500,
  minNights: 2,
  cancellationPolicy: "NON_REFUNDABLE",
  smokingAllowed: false,
  partiesAllowed: false,
};

/**
 * The create-listing input for this property: confirmed facts from this
 * file plus the owner's terms. Always request-to-book (the owner approves
 * every stay before a guest pays, matching the lodge's own direct-booking
 * model, so a date the owner hasn't confirmed can never be booked). The
 * import creates it hidden (published=false) for the owner to check before
 * going Live.
 */
export function buildLodgeOnTheLakeListing(
  photoUrls: string[],
  terms: OwnerTerms = LODGE_ON_THE_LAKE_OWNER_TERMS,
): CreateListingInput {
  return {
    title: LODGE_ON_THE_LAKE_TITLE,
    description: LODGE_ON_THE_LAKE_DESCRIPTION,
    // FYStay's types have no "lodge"; a detached single-storey holiday
    // lodge is closest to House (Cottage would suggest a stone cottage).
    propertyType: "HOUSE",
    city: LODGE_ON_THE_LAKE_CITY,
    country: "United Kingdom",
    pricePerNightCents: terms.pricePerNightCents,
    weekendPricePerNightCents: terms.weekendPricePerNightCents,
    cleaningFeeCents: 0,
    maxGuests: 6,
    bedrooms: 3,
    beds: 4,
    bathrooms: 2,
    photos: photoUrls,
    amenities: LODGE_ON_THE_LAKE_AMENITIES,
    cancellationPolicy: terms.cancellationPolicy,
    minNights: terms.minNights,
    checkInTime: null,
    checkOutTime: null,
    instantBook: false,
    smokingAllowed: terms.smokingAllowed,
    partiesAllowed: terms.partiesAllowed,
    additionalRules: LODGE_ON_THE_LAKE_ADDITIONAL_RULES,
  };
}
