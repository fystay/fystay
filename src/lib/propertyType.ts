export type PropertyType =
  | "APARTMENT"
  | "HOUSE"
  | "HOTEL"
  | "COTTAGE"
  | "VILLA"
  | "STUDIO"
  | "BED_AND_BREAKFAST"
  | "LODGE"
  | "OTHER";

export const PROPERTY_TYPES: PropertyType[] = [
  "APARTMENT",
  "HOUSE",
  "HOTEL",
  "COTTAGE",
  "VILLA",
  "STUDIO",
  "BED_AND_BREAKFAST",
  "LODGE",
  "OTHER",
];

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  APARTMENT: "Apartment",
  HOUSE: "House",
  HOTEL: "Hotel",
  COTTAGE: "Cottage",
  VILLA: "Villa",
  STUDIO: "Studio",
  BED_AND_BREAKFAST: "B&B",
  LODGE: "Lodge",
  OTHER: "Other",
};

/** The property types the search Filters panel offers, in the order shown. */
export const FILTER_PROPERTY_TYPES = ["APARTMENT", "BED_AND_BREAKFAST", "LODGE", "HOUSE", "STUDIO"] as const satisfies readonly PropertyType[];

// B&B and Lodge were added after listings already existed, so a B&B or a
// lodge listed before then is stored under another type (often OTHER). A
// listing still counts as one when its title says so; and a listing left
// as OTHER counts as whichever type its title names. Nothing is excluded
// just because the type field predates the option.
const TITLE_KEYWORDS: Partial<Record<PropertyType, RegExp>> = {
  APARTMENT: /\b(apartment|flat)\b/i,
  HOUSE: /\b(house|townhouse)\b/i,
  STUDIO: /\bstudio\b/i,
  BED_AND_BREAKFAST: /\bb\s?&\s?b\b|\bbnb\b|bed (and|&) breakfast|guest ?house/i,
  LODGE: /\blodges?\b/i,
};
const KEYWORD_MATCHES_ANY_TYPE: PropertyType[] = ["BED_AND_BREAKFAST", "LODGE"];

/** Whether a listing counts as `wanted` for the search filter. */
export function matchesPropertyType(
  listing: { propertyType: PropertyType; title?: string | null },
  wanted: PropertyType,
): boolean {
  if (listing.propertyType === wanted) return true;
  const keywords = TITLE_KEYWORDS[wanted];
  if (!keywords || !listing.title || !keywords.test(listing.title)) return false;
  return listing.propertyType === "OTHER" || KEYWORD_MATCHES_ANY_TYPE.includes(wanted);
}
