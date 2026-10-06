/**
 * The Fylde Coast towns FYStay covers - the same set as the homepage's
 * "Now covering" badges. Backs both the /destinations index tiles and
 * the dedicated /destinations/[slug] landing pages (e.g.
 * /destinations/blackpool, targeting searches like "accommodation in
 * Blackpool"), so both read from one list rather than re-deriving it.
 * `searchCity` is the exact `city` value used elsewhere (seed data, search
 * filtering) so a tile or landing page genuinely filters to that town's
 * listings, not a placeholder link.
 *
 * Lytham and St Annes get separate entries rather than one combined
 * "Lytham St Annes" - they're two distinct towns with their own high
 * street, station and character (see localGuide.ts), and a Local Guide
 * written for both at once inevitably flattens into generic "the area"
 * copy. Poulton-le-Fylde is the sixth: not a seaside town at all, but the
 * coast's rail interchange and its market square is worth a stay in its
 * own right - see its own Local Guide entry for why that's a real
 * distinction FYStay makes rather than padding the list.
 */
export type FyldeCoastDestination = {
  slug: string;
  name: string;
  /** Short, factual description - doubles as a /destinations/[slug] page's intro copy and meta description, and the homepage's large Explore card (clamped to two lines). */
  description: string;
  searchCity: string;
};

export const FYLDE_COAST_DESTINATIONS: FyldeCoastDestination[] = [
  {
    slug: "blackpool",
    name: "Blackpool",
    description:
      "Home to Blackpool Tower, the Pleasure Beach and the Illuminations - the Fylde Coast's best-known seaside resort.",
    searchCity: "Blackpool",
  },
  {
    slug: "lytham",
    name: "Lytham",
    description:
      "A windmill on the green, a championship golf course nearby and a Georgian hall inland - the quieter, more grown-up end of this coast.",
    searchCity: "Lytham",
  },
  {
    slug: "st-annes",
    name: "St Annes",
    description:
      "A Victorian pier, wide dune beaches and Ashton Gardens' formal park - St Annes' own stretch of coast, a short walk from Lytham.",
    searchCity: "St Annes",
  },
  {
    slug: "poulton-le-fylde",
    name: "Poulton-le-Fylde",
    description:
      "The coast's inland market town and rail gateway - a working market square, not a seafront, but the best-connected base on the Fylde.",
    searchCity: "Poulton-le-Fylde",
  },
  {
    slug: "fleetwood",
    name: "Fleetwood",
    description:
      "A historic fishing port at the tip of the coast, with a tram link straight down to Blackpool.",
    searchCity: "Fleetwood",
  },
  {
    slug: "thornton-cleveleys",
    name: "Thornton-Cleveleys",
    description:
      "Cleveleys' open, redesigned seafront and Thornton's 18th-century windmill village a short walk inland - two halves of one town.",
    searchCity: "Thornton-Cleveleys",
  },
];
