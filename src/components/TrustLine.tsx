import { Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The one honest thing to say about a listing's track record: a real
 * rating once reviews exist, or a plain "New on FYStay" otherwise - never
 * a placeholder rating, a fabricated review count, or an invented
 * "verified" badge. Shared between the page header and the reviews
 * section so both say the same thing.
 */
export function TrustLine({
  rating,
  reviewCount,
  size = "md",
}: {
  rating: number | null;
  reviewCount: number;
  size?: "sm" | "md";
}) {
  if (rating !== null) {
    return (
      <a
        href="#reviews"
        className={cn(
          "inline-flex w-fit self-start items-center gap-1.5 font-medium text-foreground hover:underline",
          size === "sm" ? "text-sm" : "text-base",
        )}
      >
        <Star className="h-4 w-4 shrink-0 fill-accent-500 text-accent-500" aria-hidden />
        {rating.toFixed(1)}
        <span className="font-normal text-stone-500">
          · {reviewCount} verified stay{reviewCount === 1 ? "" : "s"}
        </span>
      </a>
    );
  }

  return (
    <span
      className={cn(
        // w-fit/self-start: a tag, never stretched across a flex column.
        "inline-flex w-fit self-start items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-semibold uppercase tracking-wide text-brand-800",
        size === "sm" ? "text-[11px]" : "text-xs",
      )}
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
      New on FYStay
    </span>
  );
}
