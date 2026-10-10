"use client";

import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";

const sizeClasses = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
  xl: "text-5xl",
};

export function Logo({
  size = "md",
  withTagline = false,
  taglineClassName,
  className,
}: {
  size?: keyof typeof sizeClasses;
  withTagline?: boolean;
  /** Extra classes for the "For Your Stay" descriptor line. Its size
   * follows the wordmark (a quarter of it), so callers rarely need this. */
  taglineClassName?: string;
  className?: string;
}) {
  const tone = useNavTone();
  const isHero = tone === "hero";

  return (
    // w-fit: the lockup is always exactly as wide as the wordmark, even
    // inside a stretching flex column (the footer's). The size class sits
    // here so the descriptor below can be sized as a fraction of it (em).
    <span className={cn("inline-flex w-fit flex-col", sizeClasses[size], className)}>
      <span
        className={cn(
          // tracking-tight pulls DM Serif Display's fairly generous default
          // spacing in so "FY" and "Stay" read as one fused wordmark rather
          // than two adjacent words - font-normal guards against the
          // browser synthesizing a bolder weight than the single 400 the
          // font actually ships.
          "font-[family-name:var(--font-logo)] font-normal leading-none tracking-tight",
        )}
      >
        <span className="text-brand-600">FY</span>
        <span className={cn("text-[var(--color-ink)]", isHero && "text-white")}>Stay</span>
      </span>
      {/* Separates "FYStay" from "For Your Stay" for screen readers; the
          flex column ignores it visually. */}{" "}
      {withTagline && (
        // The name's own meaning, as the logo's descriptor line
        // (docs/brand/fystay-brand.md): spaced capitals at a quarter of the
        // wordmark's size, which with this tracking very nearly fills its
        // width at every size; justify-between absorbs the last few pixels
        // so both ends line up exactly.
        <span
          className={cn(
            "mt-[0.2em] flex w-full justify-between font-[family-name:var(--font-logo)] text-[0.25em] uppercase leading-none tracking-[0.24em] text-[var(--color-ink)]",
            isHero && "text-white/90",
            taglineClassName,
          )}
        >
          {/* The spaces are for screen readers ("For Your Stay", not
              "ForYourStay"); flex layout ignores them visually. */}
          <span>For</span> <span>Your</span> <span>Stay</span>
        </span>
      )}
    </span>
  );
}
