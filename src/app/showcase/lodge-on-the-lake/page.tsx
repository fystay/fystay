import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { ListingShowcase } from "@/components/showcase/ListingShowcase";
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

/** The card that rises over a phone's first photo: the price, the dates, one button. */
function PreviewHeroCard() {
  const { price } = LODGE_ON_THE_LAKE_SHOWCASE;
  return (
    <div className="rounded-3xl border border-border-subtle bg-surface p-4 text-foreground shadow-[var(--shadow-popover)]">
      <p className="font-serif text-2xl text-brand-800">
        {formatPrice(price.fromCents)} <span className="font-sans text-sm text-stone-600">a night</span>
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
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
      <p className="mt-2 text-center text-xs text-stone-500">
        {price.weekendCents ? `${formatPrice(price.weekendCents)} Fri & Sat · ` : ""}
        {price.minNights}-night minimum
      </p>
    </div>
  );
}

export default function LodgeOnTheLakeShowcasePage() {
  return (
    <ListingShowcase
      content={LODGE_ON_THE_LAKE_SHOWCASE}
      heroCard={<PreviewHeroCard />}
      booking={<PreviewBookingPanel />}
      contactHref="/contact"
      previewNote="Design preview, made from Lodge on the Lake's own details. Booking isn't open yet."
    />
  );
}
