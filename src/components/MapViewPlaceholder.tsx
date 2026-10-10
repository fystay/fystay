import { MapPinned } from "lucide-react";
import { Card } from "@/components/ui/Card";

/**
 * The map itself (ListingsMap/ListingsMapInner) is real and fully wired -
 * this only ever renders for the one case that isn't fixable by adding a
 * map library: a result set entirely outside FYStay's five geocoded towns
 * (see the comment on the call site in ListingsGrid.tsx). Its job is to
 * stay honest about *why* there's no map here today, not to reproduce one -
 * a fabricated pin for a town FYStay doesn't have real coordinates for
 * would be worse than this list.
 */
export function MapViewPlaceholder({ cityCounts }: { cityCounts: Map<string, number> }) {
  const cities = Array.from(cityCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="flex flex-col items-center gap-3 p-12 text-center">
      <MapPinned className="h-8 w-8 text-stone-300" />
      <p className="font-medium text-foreground">No map for these results yet</p>
      <p className="max-w-sm text-sm text-stone-500">
        These stays are in towns FYStay hasn&apos;t mapped yet. Here&apos;s where they are
        instead:
      </p>
      {cities.length > 0 && (
        <ul className="mt-2 flex flex-wrap justify-center gap-2">
          {cities.map(([city, count]) => (
            <li
              key={city}
              className="rounded-full bg-surface-muted px-3 py-1 text-sm text-stone-700"
            >
              {city} · {count}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
