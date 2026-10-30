import { Star } from "lucide-react";
import { formatPrice } from "@/lib/format";

/**
 * The card over the phone photo on a live listing: what it costs, how it's
 * rated, and one button down to the booking panel, where the dates are
 * chosen with the real calendar (so no stand-in date boxes here).
 */
export function LiveHeroCard({
  fromCents,
  weekendCents,
  minNights,
  rating,
  reviewCount,
}: {
  fromCents: number;
  weekendCents?: number;
  minNights: number;
  rating: number | null;
  reviewCount: number;
}) {
  return (
    <div className="rounded-3xl border border-border-subtle bg-surface p-4 text-foreground shadow-[var(--shadow-popover)]">
      <div className="flex items-center justify-between gap-3">
        <p>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            From
          </span>
          <span className="font-serif text-[1.7rem] leading-none text-brand-800">
            {formatPrice(fromCents)}
          </span>
          <span className="ml-1 text-sm text-stone-600">a night</span>
        </p>
        {rating !== null && reviewCount > 0 ? (
          <p className="flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">
            <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
            {rating.toFixed(1)}{" "}
            <span className="font-normal text-stone-600">({reviewCount})</span>
          </p>
        ) : weekendCents ? (
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800">
            {formatPrice(weekendCents)} Fri &amp; Sat
          </span>
        ) : null}
      </div>
      <a
        href="#booking-widget"
        className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-brand-700 text-base font-semibold text-white shadow-sm hover:bg-brand-800"
      >
        Check availability
      </a>
      <p className="mt-2 text-center text-xs text-stone-500">
        {minNights > 1 ? `${minNights}-night minimum · ` : ""}No booking fees
      </p>
    </div>
  );
}
