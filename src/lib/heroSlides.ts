/**
 * The homepage hero's places (see HeroSlides): each sold on its own terms -
 * a headline and a line of what you'd actually do there, true to the
 * place, never a template. Photos are the owner's own (public/images/hero/).
 * Each links to its place's stays: the search page with "Where" already
 * filled in, the same way a guest would pick it from the suggestions
 * (FYStay's own town for Blackpool, Google's place - id, point and area -
 * for the others). Only places with live stays are shown (liveHeroSlideKeys).
 */
export const HERO_SLIDES = [
  {
    key: "blackpool",
    place: "Blackpool",
    region: "The Fylde Coast",
    lead: "Sand, sea",
    accent: "and that Tower.",
    line: "Seven miles of promenade, the Pleasure Beach, a show at the Winter Gardens and, every autumn, the Illuminations.",
    search: "city=Blackpool",
    // Keeps the Tower in frame on a narrow screen.
    position: "object-[82%_center]",
  },
  {
    key: "windermere",
    place: "Windermere",
    region: "The Lake District",
    lead: "Wake up",
    accent: "to the lake.",
    line: "England's largest lake: the steamer to Ambleside, a fell walk before lunch and a pub by the water to end the day.",
    search:
      "place=ChIJOQG-dEWTfEgReVu7ERYcf9E&placeLabel=Windermere&lat=54.380685&lng=-2.906785&bbox=54.360443,-2.923883,54.39041,-2.889561",
    position: "object-[62%_center]",
  },
  {
    key: "liverpool",
    place: "Liverpool",
    region: "Merseyside",
    lead: "A waterfront",
    accent: "made for weekends.",
    line: "The Albert Dock, a night at the Cavern Club, match day at Anfield and the ferry across the Mersey.",
    search:
      "place=ChIJt2BwZIrfekgRAW4XP28E3EI&placeLabel=Liverpool&lat=53.408371&lng=-2.991573&bbox=53.311542,-3.01918,53.486211,-2.818",
    position: "object-[58%_center]",
  },
  {
    key: "manchester",
    place: "Manchester",
    region: "Greater Manchester",
    lead: "Where the North",
    accent: "comes alive.",
    line: "Northern Quarter bars, Ancoats kitchens, gigs at the AO Arena and match day at Old Trafford or the Etihad.",
    search:
      "place=ChIJ2_UmUkxNekgRqmv-BDgUvtk&placeLabel=Manchester&lat=53.480759&lng=-2.24263&bbox=53.365651,-2.300097,53.544588,-2.146828",
    position: "object-[72%_center]",
  },
] as const;

export type HeroSlideKey = (typeof HERO_SLIDES)[number]["key"];
