import type { Metadata } from "next";
import Image from "next/image";
import { LODGE_ON_THE_LAKE_SHOWCASE } from "@/lib/showcase/lodgeOnTheLake";
import { PreviewHeroCard, type PriceStyle } from "../PreviewHeroCard";

export const metadata: Metadata = {
  title: "Lodge on the Lake - price card options",
  robots: { index: false, follow: false },
};

const OPTIONS: { key: PriceStyle; label: string }[] = [
  { key: "tag", label: "1  Price header" },
  { key: "banner", label: "2  Price banner" },
  { key: "ticket", label: "3  Price ticket" },
];

/**
 * The three price-card options side by side, each the top of a phone's
 * screen on the listing page (the photo, the name over it, the card rising
 * over its foot). The live page shows one at a time with ?price=.
 */
export default function PriceOptionsPage() {
  const { carousel, title, place } = LODGE_ON_THE_LAKE_SHOWCASE;
  return (
    <div className="mx-auto w-full max-w-[1300px] px-6 py-8">
      <h1 className="font-serif text-3xl font-bold text-foreground">Price card options</h1>
      <p className="mt-2 text-stone-600">The top of the listing page on a phone, with each way of showing the price.</p>
      <div className="mt-8 flex gap-8 overflow-x-auto pb-6 pt-2">
        {OPTIONS.map((option) => (
          <figure key={option.key} className="w-[390px] shrink-0">
            <figcaption className="mb-3 font-semibold text-brand-800">{option.label}</figcaption>
            <div className="overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-card)] ring-1 ring-black/5">
              <div className="relative aspect-[6/7] w-full">
                <Image src={carousel[0].src} alt={carousel[0].alt} fill sizes="390px" className="object-cover" />
                <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/70 via-black/30 to-transparent" aria-hidden />
                <div className="absolute inset-x-5 bottom-[4.75rem] text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.4)]">
                  <p className="font-serif text-[2.1rem] font-bold leading-[1.05]">{title}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/85">{place}</p>
                </div>
              </div>
              <div className="relative z-10 -mt-14 px-4 pb-5">
                <PreviewHeroCard priceStyle={option.key} />
              </div>
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
