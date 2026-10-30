import { useSyncExternalStore } from "react";

/**
 * What a page wants shown in the middle of the site header while its own
 * main call to action is off screen (the listing page's price and dates, say
 * - the homepage's search pill is its own thing, see HeaderBar). A page sets
 * it when its card scrolls away and clears it when the card is back.
 */
export type HeaderPillContent = { title: string; subtitle: string; cta: string; href: string };

let current: HeaderPillContent | null = null;
const listeners = new Set<() => void>();

export function setHeaderPill(next: HeaderPillContent | null) {
  const same =
    current === next ||
    (current !== null &&
      next !== null &&
      current.title === next.title &&
      current.subtitle === next.subtitle &&
      current.cta === next.cta &&
      current.href === next.href);
  if (same) return;
  current = next;
  for (const listener of listeners) listener();
}

export function useHeaderPill(): HeaderPillContent | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
