import { format } from "date-fns";
import { parseGuestParam } from "@/lib/search";
import { parseStayDate } from "@/lib/stayDates";

/**
 * The id on a page's main search (the homepage's and the results page's),
 * so the header can tell when it has scrolled away and bring it back
 * (HeaderBar's search pill).
 */
export const PAGE_SEARCH_ID = "page-search";

/** "16-19 Nov", "30 Nov - 2 Dec", or null without both dates. */
function dateSummary(checkIn: string | null, checkOut: string | null): string | null {
  const from = checkIn ? parseStayDate(checkIn) : null;
  const to = checkOut ? parseStayDate(checkOut) : null;
  if (!from || !to) return null;
  return from.getMonth() === to.getMonth()
    ? `${format(from, "d")}-${format(to, "d MMM")}`
    : `${format(from, "d MMM")} - ${format(to, "d MMM")}`;
}

/** A search URL's where, when and who, in a few words for a one-line summary. */
export function searchSummary(params: URLSearchParams): { where: string | null; when: string; who: string } {
  const guests =
    parseGuestParam(params.get("adults") ?? undefined, 1) + parseGuestParam(params.get("children") ?? undefined, 0);
  return {
    where: params.get("city") ?? params.get("placeLabel") ?? params.get("near"),
    when: dateSummary(params.get("checkIn"), params.get("checkOut")) ?? "Any dates",
    who: `${guests} guest${guests === 1 ? "" : "s"}`,
  };
}
