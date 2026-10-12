import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchBar } from "@/components/SearchBar";
import { ListingsGrid } from "@/components/search/ListingsGrid";
import { SearchResultsLoader } from "@/components/search/SearchResultsLoader";
import { PLACE_RADIUS_MILES, parseSearchRequest } from "@/lib/searchRequest";

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
  // The heading names the search only once it's valid - ListingsGrid
  // explains what's missing otherwise.
  const request = parseSearchRequest(resolvedSearchParams);
  const location = request.ok ? request.location : null;
  const heading =
    location?.kind === "landmark"
      ? `Stays near ${location.name}`
      : location?.kind === "place"
        ? `Stays near ${location.label}`
        : location?.kind === "town"
          ? `Stays in ${location.city}`
          : "Find a place to stay";

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <Suspense>
        <SearchBar />
      </Suspense>

      <div className="mt-8">
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          {heading}
        </h1>
        {location && location.kind !== "town" && (
          <p className="mt-1 text-sm text-stone-500">
            Within {location.kind === "place" && location.bounds ? `${location.label} or ` : ""}{PLACE_RADIUS_MILES} miles of{" "}
            {location.kind === "place" ? location.label : `${location.name}, ${location.town}`}, nearest first - use Sort to
            change the order.
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
