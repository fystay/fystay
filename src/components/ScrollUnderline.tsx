"use client";

import { useEffect, useRef } from "react";

/**
 * A section heading's terracotta underline (EditorialHeader), drawn left to
 * right as the heading moves up the screen: nothing while it's at the
 * bottom edge, complete by the time it's 60% of the way up. A heading
 * already on screen when the page loads draws in to its point straight
 * away (the transition). Reduced motion: shown in full.
 */
export function ScrollUnderline() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const line = ref.current;
    if (!line) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      line.style.transform = "scaleX(1)";
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = line.getBoundingClientRect().top;
      const height = window.innerHeight;
      const progress = Math.min(1, Math.max(0, (height * 0.95 - top) / (height * 0.35)));
      line.style.transform = `scaleX(${progress})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden
      style={{ transform: "scaleX(0)" }}
      className="absolute bottom-0 left-0 h-[3px] w-full origin-left rounded-full bg-brand-500 transition-transform duration-500 ease-out"
    />
  );
}
