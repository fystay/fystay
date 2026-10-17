"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { RefObject } from "react";

/**
 * Reserves real space at the true bottom of the whole document, sized to
 * match a fixed-position element's own rendered height - not just space
 * within whatever page happens to render it. A position:fixed bar always
 * sits over the bottom of the *viewport*, so padding added only inside a
 * page's own content stops it covering that page's own content but does
 * nothing once a guest scrolls past that content into the site-wide
 * Footer, which renders after every page with no reserved space of its
 * own - without this, a fixed bar permanently hides the Footer's last few
 * rows (its legal links) once scrolled that far.
 *
 * A ResizeObserver (rather than a fixed pixel value, or reading the
 * height once) means this self-corrects if the bar's own height ever
 * changes, including collapsing to 0 via a responsive lg:hidden once the
 * viewport crosses into desktop width.
 *
 * Also exposes that same height as the --fixed-bottom-bar-height CSS
 * variable (default 0px - see globals.css) so any other fixed-position UI
 * that must avoid this bar, e.g. a floating support button pinned to the
 * bottom corner, can read the same live number instead of hardcoding a
 * guess or duplicating this observer.
 *
 * Several bars can be registered at once (the site's bottom navigation
 * plus a page's own booking or hosting bar); the space reserved is the
 * tallest of them. A page bar (the default) also tells the site's bottom
 * navigation to step aside - see usePageBottomBarPresent - so two bars
 * never stack over the content.
 */
const heights = new Map<HTMLElement, number>();
let pageBars = 0;
const listeners = new Set<() => void>();

function applyReservedSpace() {
  const tallest = Math.max(0, ...heights.values());
  if (tallest > 0) {
    document.body.style.paddingBottom = `${tallest}px`;
    document.documentElement.style.setProperty("--fixed-bottom-bar-height", `${tallest}px`);
  } else {
    document.body.style.paddingBottom = "";
    document.documentElement.style.removeProperty("--fixed-bottom-bar-height");
  }
}

function setPageBars(delta: number) {
  pageBars += delta;
  for (const listener of listeners) listener();
}

export function useReserveBottomSpace(
  ref: RefObject<HTMLElement | null>,
  { pageBar = true }: { pageBar?: boolean } = {},
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pageBar) setPageBars(1);
    const observer = new ResizeObserver(() => {
      heights.set(el, el.offsetHeight);
      applyReservedSpace();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      heights.delete(el);
      applyReservedSpace();
      if (pageBar) setPageBars(-1);
    };
  }, [ref, pageBar]);
}

/** True while a page's own fixed bottom bar (booking, checkout, hosting) is on screen. */
export function usePageBottomBarPresent(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pageBars > 0,
    () => false,
  );
}
