"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  firstRotationDelay,
  INTERACTION_PAUSE_MS,
  ROTATION_INTERVAL_MS,
  wrapIndex,
} from "@/lib/imageRotation";

/**
 * Gentle automatic rotation through a set of images (a property card's
 * photos), shared by every card that shows more than one photo.
 *
 * It only runs while all of these hold:
 * - the element is at least half on screen (IntersectionObserver), so
 *   off-screen cards cost nothing;
 * - the tab is visible;
 * - no mouse is hovering over it and nothing inside it has focus, so a
 *   guest can look at the current photo without it changing;
 * - the visitor hasn't asked for reduced motion.
 *
 * Every 5s on hover-capable devices and 6s on touch, starting from a
 * per-card offset (see firstRotationDelay) so cards change one after
 * another. Any touch on the card, or a manual change through goTo (arrows,
 * swipes), pauses it for INTERACTION_PAUSE_MS.
 *
 * Returns `previous`, the image shown before the current one, so the
 * renderer can keep it underneath while the new one fades in. `observe` is
 * a callback ref for the element to watch.
 */
export function useAutoRotate<T extends HTMLElement>({ count, seed }: { count: number; seed: string }) {
  const [node, setNode] = useState<T | null>(null);
  const [{ index, previous }, setState] = useState({ index: 0, previous: -1 });
  const [visible, setVisible] = useState(false);
  const [held, setHeld] = useState(false);
  // Bumped to re-arm the timer when it fires during a pause (a touch can
  // start one after the timer was already scheduled).
  const [wake, setWake] = useState(0);
  const pausedUntil = useRef(0);
  const started = useRef(false);

  const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", true);
  const pageVisible = useSyncExternalStore(subscribeToVisibility, getPageVisible, () => false);

  const interval = canHover ? ROTATION_INTERVAL_MS.hover : ROTATION_INTERVAL_MS.touch;
  const active = count > 1 && !reducedMotion && pageVisible && visible;

  useEffect(() => {
    if (!node || count < 2) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.intersectionRatio >= 0.5),
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, count]);

  const show = useCallback(
    (next: number) =>
      setState((current) => {
        const target = wrapIndex(next, count);
        return target === current.index ? current : { index: target, previous: current.index };
      }),
    [count],
  );

  useEffect(() => {
    if (!active || held) return;
    const base = started.current ? interval : firstRotationDelay(seed, interval);
    const delay = Math.max(base, pausedUntil.current - Date.now());
    const timer = window.setTimeout(() => {
      if (Date.now() < pausedUntil.current) {
        setWake((n) => n + 1);
        return;
      }
      started.current = true;
      show(index + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, held, interval, index, seed, show, wake]);

  /** A guest-driven change (arrow or swipe): show that image and hold off the automatic one for a while. */
  const goTo = useCallback(
    (next: number) => {
      pausedUntil.current = Date.now() + INTERACTION_PAUSE_MS;
      started.current = true;
      show(next);
    },
    [show],
  );

  const handlers = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setHeld(true);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") setHeld(false);
    },
    onFocus: () => setHeld(true),
    onBlur: (e: React.FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
    },
    onTouchStart: () => {
      pausedUntil.current = Date.now() + INTERACTION_PAUSE_MS;
    },
  };

  return { observe: setNode, index, previous, goTo, handlers, preloadNext: active };
}

function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function getPageVisible() {
  return document.visibilityState === "visible";
}
