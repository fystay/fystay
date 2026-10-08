"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Home,
  Hotel,
  LandPlot,
  SlidersHorizontal,
  Trees,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { PROPERTY_TYPE_LABEL, type PropertyType } from "@/lib/propertyType";
import type { AmenityCategorySummary } from "@/lib/amenityCategories";
import { parseListingFiltersFromParams } from "@/lib/listingSearch";
import { cn } from "@/lib/cn";

const BEDROOM_BATHROOM_OPTIONS = [0, 1, 2, 3, 4];
const RATING_OPTIONS = [0, 3, 3.5, 4, 4.5];

const PROPERTY_TYPE_ICON: Record<PropertyType, LucideIcon> = {
  APARTMENT: Building2,
  HOUSE: Home,
  HOTEL: Hotel,
  COTTAGE: Trees,
  VILLA: LandPlot,
  STUDIO: Warehouse,
  OTHER: Home,
};

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "focus-ring flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 bg-brand-50 text-brand-800"
          : "border-border-subtle text-stone-600 hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

export function FilterSheet({
  availablePropertyTypes,
  availableAmenityCategories,
}: {
  availablePropertyTypes: PropertyType[];
  availableAmenityCategories: AmenityCategorySummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const currentFilters = parseListingFiltersFromParams(
    Object.fromEntries(searchParams.entries()),
    availablePropertyTypes,
  );
  const activeCount = [
    currentFilters.propertyTypes?.length ? 1 : 0,
    currentFilters.minPriceCents || currentFilters.maxPriceCents ? 1 : 0,
    currentFilters.minBedrooms ? 1 : 0,
    currentFilters.minBathrooms ? 1 : 0,
    currentFilters.amenityCategories?.length ? 1 : 0,
    currentFilters.minRating ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const [propertyTypes, setPropertyTypes] = useState<PropertyType[]>(
    currentFilters.propertyTypes ?? [],
  );
  const [amenities, setAmenities] = useState<string[]>(currentFilters.amenityCategories ?? []);
  const [minPrice, setMinPrice] = useState(
    currentFilters.minPriceCents ? String(currentFilters.minPriceCents / 100) : "",
  );
  const [maxPrice, setMaxPrice] = useState(
    currentFilters.maxPriceCents ? String(currentFilters.maxPriceCents / 100) : "",
  );
  const [minBedrooms, setMinBedrooms] = useState(currentFilters.minBedrooms ?? 0);
  const [minBathrooms, setMinBathrooms] = useState(currentFilters.minBathrooms ?? 0);
  const [minRating, setMinRating] = useState(currentFilters.minRating ?? 0);

  function toggle<T>(list: T[], value: T, setList: (next: T[]) => void) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function resetDraft() {
    setPropertyTypes([]);
    setAmenities([]);
    setMinPrice("");
    setMaxPrice("");
    setMinBedrooms(0);
    setMinBathrooms(0);
    setMinRating(0);
  }

  function applyAndClose() {
    const params = new URLSearchParams(searchParams.toString());

    if (propertyTypes.length > 0) params.set("propertyType", propertyTypes.join(","));
    else params.delete("propertyType");

    if (amenities.length > 0) params.set("amenities", amenities.join(","));
    else params.delete("amenities");

    // A minimum above the maximum is almost always the two typed the wrong
    // way round - treat it that way rather than showing no stays at all.
    const [lowPrice, highPrice] =
      minPrice && maxPrice && Number(minPrice) > Number(maxPrice) ? [maxPrice, minPrice] : [minPrice, maxPrice];

    if (lowPrice) params.set("minPrice", lowPrice);
    else params.delete("minPrice");

    if (highPrice) params.set("maxPrice", highPrice);
    else params.delete("maxPrice");

    if (minBedrooms > 0) params.set("minBedrooms", String(minBedrooms));
    else params.delete("minBedrooms");

    if (minBathrooms > 0) params.set("minBathrooms", String(minBathrooms));
    else params.delete("minBathrooms");

    if (minRating > 0) params.set("minRating", String(minRating));
    else params.delete("minRating");

    setOpen(false);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const draftHasFilters =
    propertyTypes.length > 0 ||
    amenities.length > 0 ||
    Boolean(minPrice) ||
    Boolean(maxPrice) ||
    minBedrooms > 0 ||
    minBathrooms > 0 ||
    minRating > 0;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-2">
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-700 px-1 text-xs font-semibold text-white">
            {activeCount}
          </span>
        )}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Filters"
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85vh] w-full max-w-full overflow-y-auto rounded-b-none rounded-t-2xl sm:static sm:inset-auto sm:m-auto sm:max-h-[80vh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex flex-col gap-6 pb-24 sm:pb-0">
          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Price per night</p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Min"
                aria-label="Minimum price per night"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
              />
              <span className="text-stone-500">–</span>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Max"
                aria-label="Maximum price per night"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
            </div>
          </div>

          {availablePropertyTypes.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Property type</p>
              <div className="flex flex-wrap gap-2">
                {availablePropertyTypes.map((type) => {
                  const Icon = PROPERTY_TYPE_ICON[type];
                  return (
                    <ToggleChip
                      key={type}
                      active={propertyTypes.includes(type)}
                      onClick={() => toggle(propertyTypes, type, setPropertyTypes)}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {PROPERTY_TYPE_LABEL[type]}
                    </ToggleChip>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Bedrooms" htmlFor="minBedrooms">
              <Select
                id="minBedrooms"
                value={minBedrooms}
                onChange={(e) => setMinBedrooms(Number(e.target.value))}
              >
                {BEDROOM_BATHROOM_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Any" : `${n}+`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bathrooms" htmlFor="minBathrooms">
              <Select
                id="minBathrooms"
                value={minBathrooms}
                onChange={(e) => setMinBathrooms(Number(e.target.value))}
              >
                {BEDROOM_BATHROOM_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "Any" : `${n}+`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {availableAmenityCategories.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Amenities</p>
              <div className="flex flex-wrap gap-2">
                {availableAmenityCategories.map((category) => (
                  <ToggleChip
                    key={category.key}
                    active={amenities.includes(category.key)}
                    onClick={() => toggle(amenities, category.key, setAmenities)}
                  >
                    {category.label}
                  </ToggleChip>
                ))}
              </div>
            </div>
          )}

          <Field label="Minimum guest rating" htmlFor="minRating">
            <Select
              id="minRating"
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
            >
              {RATING_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "Any" : `${n}+ stars`}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* pb includes the iPhone home-indicator safe area: this bar sits
            flush against the bottom edge of a full-height mobile sheet, so
            without it "Show results" would land partly under the
            indicator instead of a comfortable thumb's reach above it. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex items-center justify-between gap-3 border-t border-border-subtle bg-surface px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
          <button
            type="button"
            onClick={resetDraft}
            disabled={!draftHasFilters}
            className="focus-ring rounded-lg text-sm font-medium text-stone-600 underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            Clear all
          </button>
          <Button onClick={applyAndClose}>Show results</Button>
        </div>
      </Dialog>
    </>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
