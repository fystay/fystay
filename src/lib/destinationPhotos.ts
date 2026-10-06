/**
 * Real, licensed photography for the handful of towns that have it, keyed
 * by the same slug as FYLDE_COAST_DESTINATIONS. A town with no entry here
 * falls back to the generated art (TownHeroArt) - never a hotlinked or
 * unlicensed stock photo standing in for a town FYStay hasn't actually
 * been supplied a real photo of.
 *
 * `hero` backs the /destinations/[slug] page's full-bleed banner
 * (TownHero); `tile` backs the smaller town card on the /destinations
 * index - deliberately separate fields since a wide
 * establishing shot that works as a banner can crop badly into a 4:3 tile,
 * and vice versa. Where only one real photo exists for a town, both point
 * at it; that's a placeholder-photo-parity trade-off, not a bug.
 *
 * The former "lytham-st-annes.jpg" is kept under `lytham` only, not copied
 * to `st-annes` too: the photo itself (the green and the windmill) is
 * genuinely a Lytham shot, and presenting it as "real photography" for St
 * Annes as well would be the kind of small dishonesty this file's own
 * fallback rule exists to avoid. St Annes uses TownHeroArt's generated
 * scene instead, same as any other town without a real photo yet.
 */
export const DESTINATION_PHOTOS: Partial<Record<string, { hero: string; tile: string }>> = {
  blackpool: {
    hero: "/images/destinations/blackpool-hero.jpg",
    tile: "/images/destinations/blackpool-tile.jpg",
  },
  lytham: {
    hero: "/images/destinations/lytham-st-annes.jpg",
    tile: "/images/destinations/lytham-st-annes.jpg",
  },
  "thornton-cleveleys": {
    hero: "/images/destinations/cleveleys.jpg",
    tile: "/images/destinations/cleveleys.jpg",
  },
};
