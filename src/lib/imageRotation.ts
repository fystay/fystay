/**
 * Timing for property-card photo rotation (see useAutoRotate). Pure
 * functions so the stagger and wrap-around can be unit-tested without a DOM.
 */

/** Pointer devices that can hover (desktop) rotate every 5s; touch devices more gently, every 6s. */
export const ROTATION_INTERVAL_MS = { hover: 5000, touch: 6000 } as const;

/** How long a card stays paused after someone swipes, taps an arrow or touches it. */
export const INTERACTION_PAUSE_MS = 10_000;

/** Wraps an index into 0..count-1 in either direction. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/** A small stable string hash (FNV-1a), so a card's stagger is the same on the server and the client. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Delay before a card's first automatic change: between half an interval
 * and one and a half intervals, spread by the card's own seed, so cards
 * visible together change one after another rather than all at once.
 * Later changes use the plain interval, and because each card started at
 * its own point they stay out of step.
 */
export function firstRotationDelay(seed: string, interval: number): number {
  return Math.round(interval / 2 + (hashSeed(seed) % interval));
}
