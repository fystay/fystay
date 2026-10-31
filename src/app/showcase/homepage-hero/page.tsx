import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchBar } from "@/components/SearchBar";
import { HeroSlides } from "@/components/HeroBanner";
import { PAGE_SEARCH_ID } from "@/lib/searchSummary";
import type { HeroStay } from "@/lib/heroStays";
import { LODGE_ON_THE_LAKE_SHOWCASE } from "@/lib/showcase/lodgeOnTheLake";

// A design preview, not the live homepage: kept out of search results.
export const metadata: Metadata = {
  title: "Homepage hero - Lodge on the Lake (preview)",
  robots: { index: false, follow: false },
};

const lodge = LODGE_ON_THE_LAKE_SHOWCASE;

// The stay as the homepage would show it once it's published with a live
// Spotlight placement; "preview-" ids are never counted as views or clicks.
const PREVIEW_STAY: HeroStay = {
  promotionId: "preview-lodge-on-the-lake",
  listingId: "preview",
  title: lodge.title,
  city: "Carnforth",
  priceFromCents: lodge.price.fromCents,
  photo: lodge.hero.src,
  href: "/showcase/lodge-on-the-lake",
};

/**
 * What the homepage's top could look like with Lodge on the Lake as the
 * Spotlight stay: the same hero and search card as the real homepage, built
 * from the same components, with the lodge's own details. A mock-up - the
 * live homepage shows a stay here only once it is published and has a live
 * Spotlight placement (see src/lib/heroStays.ts).
 */
export default function HomepageHeroPreview() {
  return (
    <>
      <p role="status" className="bg-brand-50 px-6 py-2 text-center text-sm text-brand-900">
        Mock-up of the homepage with Lodge on the Lake as the Spotlight stay. Not live.
      </p>
      <div className="flex min-h-[calc(100svh-77px-var(--fixed-bottom-bar-height,0px))] flex-col lg:block lg:min-h-0">
        <section className="relative isolate flex min-h-[230px] w-full flex-1 flex-col lg:h-[64svh] lg:max-h-[660px] lg:min-h-[520px] lg:flex-none">
          <HeroSlides slideKeys={[]} stays={[PREVIEW_STAY]} />
        </section>
        <div className="sticky bottom-[calc(var(--fixed-bottom-bar-height,0px)+env(safe-area-inset-bottom))] z-10 mx-auto w-full max-w-6xl px-4 pb-4 sm:px-6 lg:relative lg:bottom-auto lg:pb-0">
          <div id={PAGE_SEARCH_ID} className="-mt-14 sm:-mt-20 lg:-mt-[112px]">
            <Suspense>
              <SearchBar liveUpdate={false} className="max-w-none shadow-[var(--shadow-popover)]" />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}
