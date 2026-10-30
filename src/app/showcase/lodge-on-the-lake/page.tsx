import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { ListingShowcase, type TitleStyle } from "@/components/showcase/ListingShowcase";
import { cn } from "@/lib/cn";
import { LODGE_ON_THE_LAKE_SHOWCASE } from "@/lib/showcase/lodgeOnTheLake";
import { formatPrice } from "@/lib/format";

// A design preview, not a live listing: kept out of search results.
export const metadata: Metadata = {
  title: "Lodge on the Lake - page preview",
  robots: { index: false, follow: false },
};

/**
 * What Lodge on the Lake's own page on FYStay could look like (see
 * ListingShowcase), built from the owner's real details. The booking panel
 * is a stand-in: online booking opens when the lodge goes live, and on a
 * live listing this is the real booking widget.
 */
function PreviewBookingPanel() {
  const { price } = LODGE_ON_THE_LAKE_SHOWCASE;
  return (
    <div className="rounded-3xl bg-surface p-6 text-foreground shadow-[var(--shadow-popover)] sm:p-8">
      <p className="font-serif text-3xl text-brand-800">
        {formatPrice(price.fromCents)} <span className="font-sans text-base text-stone-600">a night</span>
      </p>
      <p className="mt-1 text-sm text-stone-600">
        {price.weekendCents ? `${formatPrice(price.weekendCents)} on Friday and Saturday nights · ` : ""}
        {price.minNights}-night minimum
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        {["Check-in", "Check-out"].map((label) => (
          <div key={label} className="flex items-center gap-2.5 rounded-xl border border-border-subtle px-3 py-2.5">
            <CalendarDays className="h-4 w-4 text-brand-600" aria-hidden />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">{label}</p>
              <p className="text-sm text-stone-500">Add date</p>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled
        className="mt-4 h-12 w-full cursor-not-allowed rounded-xl bg-brand-700 text-base font-semibold text-white opacity-60"
      >
        Request to book
      </button>
      <p className="mt-3 text-center text-xs text-stone-500">
        You&apos;ll see the full price before you pay. Nothing is charged until the owners approve your stay.
      </p>
      <p className="mt-4 border-t border-border-subtle pt-4 text-sm text-stone-600">{price.cancellation}</p>
    </div>
  );
}

type PriceStyle = "tag" | "banner" | "ticket";

/** The card that rises over a phone's first photo: the price, the dates, one button. */
function PreviewHeroCard({ priceStyle, showName }: { priceStyle: PriceStyle; showName: boolean }) {
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
        {showName && (
          <div className="mb-3 border-b border-border-subtle pb-3">
            <p className="font-serif text-xl font-bold leading-tight text-foreground">{LODGE_ON_THE_LAKE_SHOWCASE.title}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-700">{LODGE_ON_THE_LAKE_SHOWCASE.place}</p>
          </div>
        )}

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

const TITLE_STYLES: TitleStyle[] = ["overlay", "above", "card"];
const PRICE_STYLES: PriceStyle[] = ["tag", "banner", "ticket"];

// ?title=overlay|above|card and ?price=tag|banner|ticket let the options be
// compared on the preview; each defaults to the first.
export default async function LodgeOnTheLakeShowcasePage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; price?: string }>;
}) {
  const { title, price } = await searchParams;
  const titleStyle = TITLE_STYLES.find((style) => style === title) ?? "overlay";
  const priceStyle = PRICE_STYLES.find((style) => style === price) ?? "tag";
  return (
    <ListingShowcase
      content={LODGE_ON_THE_LAKE_SHOWCASE}
      titleStyle={titleStyle}
      heroCard={<PreviewHeroCard priceStyle={priceStyle} showName={titleStyle === "card"} />}
      booking={<PreviewBookingPanel />}
      contactHref="/contact"
      previewNote="Design preview, made from Lodge on the Lake's own details. Booking isn't open yet."
    />
  );
}
