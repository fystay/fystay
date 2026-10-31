import { unstable_cache } from "next/cache";
import { randomInt } from "node:crypto";
import sharp from "sharp";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { BASE_URL } from "@/lib/baseUrl";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { liveSpotlightWhere, SPOTLIGHT_SLOTS } from "@/lib/listingPromotions";

/**
 * Paid Spotlight stays that take over the homepage hero (see HeroSlides): at
 * most this many, each with a photo big and wide enough to be a hero. With
 * none, the hero is the places slideshow it always was.
 */
export const HERO_STAY_SLOTS = 3;
const MIN_HERO_WIDTH = 1600;
const MIN_HERO_RATIO = 1.4; // width / height: landscape, so the crop keeps the photo's subject

export type HeroStay = {
  promotionId: string;
  listingId: string;
  title: string;
  city: string;
  priceFromCents: number;
  photo: string;
  /** Where the hero links to, if not the listing page (a design preview). */
  href?: string;
};

export function isHeroPhoto(size: { width: number; height: number }): boolean {
  return size.width >= MIN_HERO_WIDTH && size.width / size.height >= MIN_HERO_RATIO;
}

/** The first `limit` bytes of a photo (a server that ignores Range sends it all; only the start is kept). */
async function fetchPhotoStart(url: string, limit: number): Promise<Buffer | null> {
  // A self-hosted photo is stored as a path on this site.
  const response = await fetch(new URL(url, BASE_URL), { headers: { Range: `bytes=0-${limit - 1}` }, signal: AbortSignal.timeout(4000) });
  if (!response.ok || !response.body) return null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  while (received < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  void reader.cancel().catch(() => {});
  return Buffer.concat(chunks);
}

/**
 * A photo's pixel size, or null if it can't be read. A JPEG or PNG gives it
 * up in its first bytes; a WebP may need more, so a second, larger read is
 * tried before giving up.
 */
async function readPhotoSize(url: string): Promise<{ width: number; height: number } | null> {
  for (const limit of [64 * 1024, 2 * 1024 * 1024]) {
    try {
      const start = await fetchPhotoStart(url, limit);
      if (!start) return null;
      const { width, height } = await sharp(start).metadata();
      if (width && height) return { width, height };
    } catch {
      // Not enough of the file yet (or not an image): try the larger read.
    }
  }
  return null;
}

// A photo's size doesn't change, so look once a day, not on every page view.
const cachedPhotoSize = unstable_cache(readPhotoSize, ["hero-photo-size"], { revalidate: 24 * 60 * 60 });

/** Whether a photo is big and wide enough to fill a wide hero (looked at once a day per photo). */
export async function isWidePhoto(url: string): Promise<boolean> {
  const size = await cachedPhotoSize(url);
  return size !== null && isHeroPhoto(size);
}

/** The listing's first photo that is big and wide enough for the hero (only its first few are tried). */
export async function heroPhotoOf(photos: string[]): Promise<string | null> {
  for (const photo of photos.slice(0, 3)) {
    const size = await cachedPhotoSize(photo);
    if (size && isHeroPhoto(size)) return photo;
  }
  return null;
}

/** Live Spotlight placements that qualify for the hero, in random order so every paying host gets turns, at most HERO_STAY_SLOTS. */
export async function loadHeroStays(now: Date = new Date()): Promise<HeroStay[]> {
  try {
    const promotions = await prisma.listingPromotion.findMany({
      where: { ...liveSpotlightWhere(now), AND: [{ listing: bookableHostWhere() }] },
      orderBy: { startsAt: "asc" },
      distinct: ["listingId"],
      take: SPOTLIGHT_SLOTS,
      select: {
        id: true,
        listing: { select: { id: true, title: true, city: true, pricePerNightCents: true, photos: true } },
      },
    });
    const shuffled = [...promotions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const stays: HeroStay[] = [];
    for (const { id, listing } of shuffled) {
      if (stays.length >= HERO_STAY_SLOTS) break;
      const photo = await heroPhotoOf(listing.photos);
      if (!photo) continue;
      stays.push({
        promotionId: id,
        listingId: listing.id,
        title: listing.title,
        city: listing.city,
        priceFromCents: listing.pricePerNightCents,
        photo,
      });
    }
    return stays;
  } catch (error) {
    console.error("Couldn't load the hero's Spotlight stays", error);
    Sentry.captureException(error);
    return [];
  }
}
