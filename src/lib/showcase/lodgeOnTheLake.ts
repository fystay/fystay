import type { ShowcaseContent, ShowcasePhoto } from "@/lib/showcase/types";

/**
 * Lodge on the Lake as a bespoke FYStay page. Every fact is the owner's own,
 * from the property's site (lsllodge.vercel.app) and the details recorded in
 * src/lib/listingImports/lodgeOnTheLake.ts (terms given 10 Oct 2026, photo
 * permission confirmed the same day). Nothing here is a guess: what the
 * owner hasn't stated (check-in times, deposit, pets, street address) is
 * left out.
 */
const dir = "/images/showcase/lodge-on-the-lake";
const photo = (file: string, alt: string, label?: string, position?: string): ShowcasePhoto => ({ src: `${dir}/${file}.jpg`, alt, label, position });

const ACROSS_WATER = photo("lodge-across-water", "The lodge seen across the water on a sunny day, its decking and seating reflected in the lake", "From across the water", "object-[50%_62%]");
const DECK = photo("deck-view-fountain", "Wicker chairs and a glass-topped table on the decking, looking over a glass balustrade to the lake and its fountain", "The deck", "object-[50%_32%]");
const LOUNGE = photo("living-room-media-wall", "Living room with a grey sofa facing a long electric fire, and a dining table by the patio doors", "The lounge", "object-[50%_55%]");
const FIRE = photo("media-wall-fire", "A wide electric fire framed by lit shelves and slatted wood panels");
const ISLAND = photo("kitchen-island", "Kitchen island with open shelving and grey bar stools, white cabinets and a built-in oven");
const KITCHEN = photo("kitchen", "Kitchen with white cabinets, an island with two bar stools, and patio doors");
const MAIN_BEDROOM = photo("main-bedroom", "Main bedroom with white bedding, a grey throw and three framed peony prints above the bed", "Main bedroom", "object-[50%_60%]");
const MAIN_ART = photo("main-bedroom-art", "The main bed dressed with pink velvet cushions beneath peony prints");
const SECOND_BEDROOM_DETAIL = photo("second-bedroom-detail", "The second bed with peacock-print cushions");
const SECOND_BEDROOM = photo("second-bedroom", "Second bedroom with a tall grey upholstered headboard and matching bedside lamps");
const TWIN = photo("twin-bedroom", "Twin bedroom with two single beds either side of a bedside table");
const BATHROOM = photo("bathroom", "Bathroom with a basin in a wood-effect vanity and a large mirror");
const WARDROBE = photo("walk-in-wardrobe", "Walk-in wardrobe with a hanging rail, shelving and drawers");
const UTILITY = photo("utility-room", "Utility room with a second sink and white cupboards");
const NEIGHBOURS = photo("lodge-and-neighbours", "The lodge among its neighbours, behind a lawn at the water's edge");
const EVENING = photo("deck-evening", "The decking at dusk, lit by post lights, with the lit windows of lodges across the water", "Evening on the deck");
const GAZEBO = photo("deck-gazebo-evening", "A covered seating area on the decking after dark, lit by small deck lights");

export const LODGE_ON_THE_LAKE_SHOWCASE: ShowcaseContent = {
  title: "Lodge on the Lake",
  place: "South Lakeland Leisure Village, Carnforth",
  headline: { before: "Slow mornings, ", accent: "lake light", after: ", and room to breathe." },
  intro:
    "A three-bedroom lodge with its own deck right over the water, between the southern Lake District, the Yorkshire Dales and the Morecambe Bay coast. Coffee on the deck, evenings under the lights, and nowhere you need to be.",
  hero: DECK,
  gallery: [ACROSS_WATER, LOUNGE, ISLAND, MAIN_BEDROOM, EVENING, FIRE, KITCHEN, MAIN_ART, SECOND_BEDROOM, SECOND_BEDROOM_DETAIL, TWIN, BATHROOM, WARDROBE, UTILITY, NEIGHBOURS, GAZEBO],
  facts: [
    { label: "Sleeps", value: "Up to 6" },
    { label: "Bedrooms", value: "3" },
    { label: "Bathrooms", value: "2" },
    { label: "Outside", value: "Deck on the water" },
  ],
  inside: {
    kicker: "Inside the lodge",
    title: "Light, warm and made for gathering",
    body: "An open-plan living and dining room arranged around an electric feature fire, a kitchen island for morning coffee, and patio doors that fill the room with light.",
  },
  sleeping: {
    kicker: "Sleeping",
    title: "Three bedrooms, each with its own character",
    rooms: [
      { name: "Main bedroom", beds: "King-size bed", photo: MAIN_ART },
      { name: "Second bedroom", beds: "King-size bed", photo: SECOND_BEDROOM },
      { name: "Twin bedroom", beds: "Two single beds", photo: TWIN },
    ],
  },
  afterDark: {
    kicker: "After dark",
    title: "Evenings on the deck",
    body: "As the light fades, the deck lights come on and the lodges across the water glow. Pull up a chair, take a blanket outside and stay out a little longer.",
    photos: [EVENING, GAZEBO],
  },
  setting: {
    kicker: "The setting",
    title: "On the water, on the edge of the Lake District",
    body: "The lodge sits at the water's edge within South Lakeland Leisure Village, set back from the village's main road, with parking for two cars.",
    points: [
      {
        title: "The leisure village",
        body: "A pool, gym and spa, and an on-site bar and restaurant. Leisure passes aren't included in your stay: they're bought by the day or the week at the leisure centre.",
      },
      {
        title: "Fishing",
        body: "Available on the village's lakes, subject to the village's rules. You'll need a valid rod licence.",
      },
      {
        title: "Getting out",
        body: "The southern Lake District, the Yorkshire Dales and the Morecambe Bay coastline are all within driving distance. The Dales National Park is about an hour away by car.",
      },
    ],
  },
  amenities: [
    "Wifi",
    "Fully equipped kitchen",
    "Lake view",
    "Private decking over the lake",
    "Parking for 2 cars",
    "Electric feature fire",
    "TV",
    "Dedicated workspace",
    "Utility room",
  ],
  goodToKnow: [
    "Two nights minimum.",
    "No smoking, and no parties, events or stag and hen groups.",
    "Leisure passes for the village's pool, gym and spa are bought separately.",
  ],
  hostNote: "Looked after by the people who own it.",
  price: {
    fromCents: 25_500,
    weekendCents: 27_500,
    minNights: 2,
    cancellation: "Free to cancel within 24 hours of booking; after that, no cancellation.",
  },
};
