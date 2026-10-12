"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/Select";
import { SORT_OPTIONS, parseSortParam } from "@/lib/listingSearch";

export function SortDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Mirrors ListingsGrid's own default: a landmark search with no explicit
  // sort yet is actually rendered nearest-first, so the dropdown should
  // say that too rather than showing "Recommended" over a list that isn't.
  const rawSort = searchParams.get("sort");
  const currentSort = parseSortParam(rawSort ?? (searchParams.get("near") || searchParams.get("place") ? "distance_asc" : undefined));

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "recommended") params.delete("sort");
    else params.set("sort", value);
    // A new order starts from the top, not page N of the re-sorted list.
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Select
      aria-label="Sort results"
      value={currentSort}
      onChange={(e) => handleChange(e.target.value)}
      className="w-auto"
    >
      {SORT_OPTIONS.map((option) => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
