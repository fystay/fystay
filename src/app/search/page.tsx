import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchBar } from "@/components/SearchBar";
import { ListingsGrid } from "@/components/search/ListingsGrid";
import { SearchResultsLoader } from "@/components/search/SearchResultsLoader";
import { findLandmarkByName } from "@/lib/landmarks";

type SearchParams = Record<string, string | string[] | undefined>;

export const metadata: Metadata = {
  title: "Search results",
  description: "Browse available places to stay from local hosts on FYStay.",
  // Every combination of filters/sort/dates renders from the same URL
  // shape, none of it worth indexing separately from the homepage.
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const nearParam = typeof resolvedSearchParams.near === "string" ? resolvedSearchParams.near : "";
  const landmark = nearParam ? findLandmarkByName(nearParam) : undefined;
  const city = typeof resolvedSearchParams.city === "string" ? resolvedSearchParams.city.trim() : "";

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <Suspense>
        <SearchBar />
      </Suspense>

      <div className="mt-8">
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          {landmark ? `Stays near ${landmark.name}` : city ? `Stays in ${city}` : "Stays from local hosts"}
        </h1>
        {landmark && (
          <p className="mt-1 text-sm text-stone-500">
            Sorted by distance from {landmark.name}, {landmark.town} - use Sort to change that.
          </p>
        )}
        <div className="mt-6">
          <Suspense fallback={<SearchResultsLoader />}>
            <ListingsGrid searchParams={resolvedSearchParams} showResultsView />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
