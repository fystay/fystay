import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { loadLastMinuteDeals } from "@/components/LastMinuteDeals";
import { ListingCard } from "@/components/ListingCard";
import { HomeSectionEmpty } from "@/components/HomeSectionEmpty";

export const metadata = pageMetadata({
  title: "Last Minute Deals",
  description: "Stays on the Fylde Coast with nights free in the coming days for less, and genuine price drops from local hosts.",
  path: "/deals",
});

// Live availability and today's date decide which deals count.
export const dynamic = "force-dynamic";

/** Every genuine deal right now (see loadLastMinuteDeals) - the homepage row's "View all". */
export default async function DealsPage() {
  const { deals, savedListingIds, isLoggedIn } = await loadLastMinuteDeals();

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-700">
        <span aria-hidden className="h-[2px] w-6 rounded-full bg-brand-600" />
        Last minute deals
      </p>
      <h1 className="mt-2 text-2xl font-bold text-foreground sm:text-3xl">A little escape, closer than you think.</h1>
      <p className="mt-2 max-w-2xl text-sm text-stone-500 sm:text-base">
        Stays with nights free in the coming days, for less, and genuine price drops - only real offers from local
        hosts. Pick your dates on the stay to see the price for your trip.
      </p>

      {deals.length === 0 ? (
        <div className="mt-8">
          <HomeSectionEmpty
            message="No last-minute deals today. Deals from local hosts show here as soon as they're added."
            link={{ href: "/search", label: "Browse all stays" }}
          />
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {deals.map((card) => (
            <li key={card.id}>
              <ListingCard
                listing={card}
                isSaved={savedListingIds.has(card.id)}
                isLoggedIn={isLoggedIn}
                size="large"
                showLastMinutePrice
                cta="View deal"
                frame="editorial"
              />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 text-sm text-stone-500">
        Looking for something else?{" "}
        <Link href="/search" className="font-medium text-brand-700 hover:underline">
          Search all stays
        </Link>
      </p>
    </div>
  );
}
