import { CalendarDays } from "lucide-react";
import { LODGE_ON_THE_LAKE_SHOWCASE } from "@/lib/showcase/lodgeOnTheLake";
import { formatPrice } from "@/lib/format";

/**
 * The card that rises over a phone's first photo: a price header (the
 * nightly price, with the weekend price beside it), the dates, one button.
 * A stand-in until the lodge is live; then it's the real booking widget.
 */
export function PreviewHeroCard() {
  const { price } = LODGE_ON_THE_LAKE_SHOWCASE;

  return (
    <div className="rounded-3xl border border-border-subtle bg-surface p-4 text-foreground shadow-[var(--shadow-popover)]">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-border-subtle pb-3">
        <p>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">From</span>
          <span className="font-serif text-[1.7rem] leading-none text-brand-800">{formatPrice(price.fromCents)}</span>
          <span className="ml-1 text-sm text-stone-600">a night</span>
        </p>
        {price.weekendCents && (
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800">{formatPrice(price.weekendCents)} Fri &amp; Sat</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {["Check-in", "Check-out"].map((label) => (
          <div key={label} className="flex items-center gap-2 rounded-xl border border-border-subtle px-3 py-2">
            <CalendarDays className="h-4 w-4 text-brand-600" aria-hidden />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">{label}</p>
              <p className="text-sm text-stone-500">Add date</p>
            </div>
          </div>
        ))}
      </div>
      <a href="#book" className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-brand-700 text-base font-semibold text-white shadow-sm hover:bg-brand-800">
        Check availability
      </a>
      <p className="mt-2 text-center text-xs text-stone-500">{price.minNights}-night minimum</p>
    </div>
  );
}
