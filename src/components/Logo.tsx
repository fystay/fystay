"use client";

import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";

const sizeClasses = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
  xl: "text-5xl",
};

// The descriptor line's size per logo size: 7px under the header's (lg)
// wordmark spans it exactly; the sign-in pages' larger (xl) wordmark gets a
// proportionally larger line so it still spans the full width.
const taglineSizeClasses = {
  sm: "mt-1.5 text-[7px]",
  md: "mt-2 text-[7px]",
  lg: "mt-2 text-[7px]",
  xl: "mt-2.5 text-[9.4px]",
};

export function Logo({
  size = "md",
  withTagline = false,
  taglineClassName,
  className,
}: {
  size?: keyof typeof sizeClasses;
  withTagline?: boolean;
  /** Extra classes for the "· Apartments · B&Bs · Lodges" descriptor line
   * (small spaced capitals, sized per logo size). */
  taglineClassName?: string;
  className?: string;
}) {
  const tone = useNavTone();
  const isHero = tone === "hero";

  return (
    // w-fit: the lockup is only as wide as its content, even inside a
    // stretching flex column (the footer's).
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
      {/* Separates "FYStay" from its descriptor for screen readers; the
          flex column ignores it visually. */}{" "}
      {withTagline && (
        // What's on the marketplace, as the logo's descriptor line - the
        // pre-rebrand "Apartments · B&Bs · Lodges" styling (f426c2f): small
        // spaced capitals clear of the wordmark's descenders.
        <span
          className={cn(
            "flex items-center gap-1 whitespace-nowrap font-[family-name:var(--font-logo)] uppercase leading-tight tracking-wide text-[var(--color-ink)]",
            taglineSizeClasses[size],
            isHero && "text-white/90",
            taglineClassName,
          )}
        >
          {/* The spaces are for screen readers; flex layout ignores them visually. */}
          <span className={cn("text-stone-400", isHero && "text-white/40")} aria-hidden>
            &middot;
          </span>{" "}
          <span>Apartments</span>{" "}
          <span className={cn("text-stone-400", isHero && "text-white/40")} aria-hidden>
            &middot;
          </span>{" "}
          <span>B&amp;Bs</span>{" "}
          <span className={cn("text-stone-400", isHero && "text-white/40")} aria-hidden>
            &middot;
          </span>{" "}
          <span>Lodges</span>
        </span>
      )}
    </span>
  );
}
