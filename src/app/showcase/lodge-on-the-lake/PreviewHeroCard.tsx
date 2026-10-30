import { CalendarDays } from "lucide-react";
import { LODGE_ON_THE_LAKE_SHOWCASE } from "@/lib/showcase/lodgeOnTheLake";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/cn";

export type PriceStyle = "tag" | "banner" | "ticket";

/** The card that rises over a phone's first photo: the price, the dates, one button. */
export function PreviewHeroCard({ priceStyle }: { priceStyle: PriceStyle }) {
  const { price } = LODGE_ON_THE_LAKE_SHOWCASE;
  const fromLine = (
    <>
      <span className="font-serif text-[1.7rem] leading-none text-brand-800">{formatPrice(price.fromCents)}</span>
      <span className="ml-1 text-sm text-stone-600">a night</span>
    </>
  );
  // The weekend price is already shown in the "tag" header and the "banner"'s foot.
  const note = priceStyle === "ticket" && price.weekendCents ? `${formatPrice(price.weekendCents)} Fri & Sat · ${price.minNights}-night minimum` : `${price.minNights}-night minimum`;

  return (
    <div className="relative rounded-3xl border border-border-subtle bg-surface text-foreground shadow-[var(--shadow-popover)]">
      {priceStyle === "ticket" && (
        <span className="absolute -top-4 left-5 flex items-baseline gap-1 rounded-full bg-brand-700 px-4 py-1.5 text-white shadow-md">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80">From</span>
          <span className="font-serif text-xl leading-none">{formatPrice(price.fromCents)}</span>
          <span className="text-xs text-white/85">a night</span>
        </span>
      )}

      {priceStyle === "banner" && (
        <div className="flex items-baseline justify-between gap-3 rounded-t-3xl bg-brand-50 px-4 py-3">
          <p>{fromLine}</p>
          <p className="text-xs font-medium text-brand-800">{price.minNights}-night minimum</p>
        </div>
      )}

      <div className={cn("p-4", priceStyle === "ticket" && "pt-6")}>
        {priceStyle === "tag" && (
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-border-subtle pb-3">
            <p>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">From</span>
              {fromLine}
            </p>
            {price.weekendCents && (
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800">{formatPrice(price.weekendCents)} Fri &amp; Sat</span>
            )}
          </div>
        )}

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
        <p className="mt-2 text-center text-xs text-stone-500">{priceStyle === "banner" ? (price.weekendCents ? `${formatPrice(price.weekendCents)} on Fri & Sat nights` : "") : note}</p>
      </div>
    </div>
  );
}
