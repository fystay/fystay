"use client";

import { useState } from "react";
import { AMENITY_OPTIONS } from "@/lib/amenityOptions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Camera, ClipboardList, Home, MapPin, Percent, ShieldCheck, Wallet, Zap } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Label";
import { hostCommissionFor } from "@/lib/pricing";
import { commissionRangeText, CURRENT_DYNAMIC_POLICY, formatRate, LEGACY_FIXED_10 } from "@/lib/pricingPolicy";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { LAST_MINUTE_WINDOW_OPTIONS } from "@/lib/deals";
import { Button } from "@/components/ui/Button";
import { PhotoUploader } from "@/components/PhotoUploader";
import { SectionHeading } from "@/components/SectionHeading";
import { resolveCancellationPolicy, type CancellationPolicyKind } from "@/lib/cancellationPolicy";
import { hasBedroomCountMismatch } from "@/lib/listingDataQuality";
import { PROPERTY_TYPES, PROPERTY_TYPE_LABEL, type PropertyType } from "@/lib/propertyType";
import {
  RoomTypesEditor,
  roomTypePayload,
  type RoomTypeFormValues,
} from "@/components/host/RoomTypesEditor";
import { ListingDiscounts } from "@/components/host/ListingDiscounts";
import { cn } from "@/lib/cn";
import {
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  formatListingTime,
  isCanonicalTime,
  LISTING_TIME_FIELDS,
  parseListingTime,
  quietHoursError,
  type ListingTimeField,
} from "@/lib/listingTimes";
import { countOptions, LISTING_COUNT_RANGES, nightOptions, stayLengthError } from "@/lib/listingFormOptions";

function AmenityCheckbox({
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
        "focus-ring rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 bg-brand-50 text-brand-800"
          : "border-border-subtle text-stone-600 hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}

/** A whole-number dropdown - easier than a number box on a phone, and it can't hold a value the server refuses. */
function NumberSelect({
  id,
  value,
  options,
  onChange,
  format = String,
  emptyLabel,
  describedBy,
}: {
  id: string;
  value: string;
  options: number[];
  onChange: (value: string) => void;
  format?: (n: number) => string;
  /** Adds a first, blank option ("No maximum"); without it the field is required. */
  emptyLabel?: string;
  describedBy?: string;
}) {
  return (
    <Select
      id={id}
      required={emptyLabel === undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-describedby={describedBy}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((n) => (
        <option key={n} value={n}>
          {format(n)}
        </option>
      ))}
    </Select>
  );
}

const nightsLabel = (n: number) => (n === 1 ? "1 night" : `${n} nights`);

export type ListingFormValues = {
  title: string;
  description: string;
  propertyType: PropertyType;
  city: string;
  country: string;
  address: string;
  pricePerNight: string;
  /** Friday/Saturday price; blank means the same as pricePerNight. */
  weekendPricePerNight: string;
  securityDeposit: string;
  weeklyDiscountPercent: string;
  monthlyDiscountPercent: string;
  lastMinuteDiscountPercent: string;
  lastMinuteWindowDays: string;
  maxGuests: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  photos: string[];
  amenities: string[];
  cancellationPolicy: CancellationPolicyKind;
  customCancellationCutoffDays: string;
  customCancellationRefundPercent: string;
  minNights: string;
  maxNights: string;
  instantBook: boolean;
  checkInTime: string;
  checkOutTime: string;
  selfCheckIn: boolean;
  checkInInstructions: string;
  wifiNetwork: string;
  wifiPassword: string;
  smokingAllowed: boolean;
  partiesAllowed: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  additionalRules: string;
  // Only meaningful when propertyType is "HOTEL" - empty for every other
  // property type, which keeps using the flat price/capacity fields above.
  roomTypes: RoomTypeFormValues[];
};

const emptyValues: ListingFormValues = {
  title: "",
  description: "",
  propertyType: "APARTMENT",
  city: "",
  country: "",
  address: "",
  pricePerNight: "",
  weekendPricePerNight: "",
  securityDeposit: "",
  weeklyDiscountPercent: "",
  monthlyDiscountPercent: "",
  lastMinuteDiscountPercent: "",
  lastMinuteWindowDays: "7",
  maxGuests: "2",
  bedrooms: "1",
  beds: "1",
  bathrooms: "1",
  photos: [],
  amenities: [],
  cancellationPolicy: "MODERATE",
  customCancellationCutoffDays: "7",
  customCancellationRefundPercent: "50",
  minNights: "1",
  maxNights: "",
  instantBook: true,
  // New listings start on the usual UK holiday-let times; the host can
  // change or clear either.
  checkInTime: DEFAULT_CHECK_IN_TIME,
  checkOutTime: DEFAULT_CHECK_OUT_TIME,
  selfCheckIn: false,
  checkInInstructions: "",
  wifiNetwork: "",
  wifiPassword: "",
  smokingAllowed: false,
  partiesAllowed: false,
  quietHoursStart: "",
  quietHoursEnd: "",
  additionalRules: "",
  roomTypes: [],
};


/**
 * Saved times that aren't a picker "HH:MM" - free text from before the time
 * picker ("After 3pm", "Flexible"). They're kept exactly as saved, and left
 * out of the save, until the host picks a new time or removes them.
 */
function legacyTimesOf(values: ListingFormValues): Partial<Record<ListingTimeField, string>> {
  const legacy: Partial<Record<ListingTimeField, string>> = {};
  for (const field of LISTING_TIME_FIELDS) {
    const raw = values[field].trim();
    if (raw && !isCanonicalTime(raw)) legacy[field] = values[field];
  }
  return legacy;
}

/** Starting values with each time field as the picker shows it: a saved "After 3pm" reads as 15:00, "Flexible" as blank. */
function withPickerTimes(values: ListingFormValues): ListingFormValues {
  const next = { ...values };
  for (const field of LISTING_TIME_FIELDS) next[field] = parseListingTime(values[field]) ?? "";
  return next;
}

function splitAmenities(amenities: string[]): { selected: string[]; custom: string } {
  const selected: string[] = [];
  const custom: string[] = [];
  for (const amenity of amenities) {
    const match = AMENITY_OPTIONS.find((option) => option.toLowerCase() === amenity.toLowerCase());
    if (match) selected.push(match);
    else custom.push(amenity);
  }
  return { selected, custom: custom.join(", ") };
}

const POLICY_PREVIEWS: Record<Exclude<CancellationPolicyKind, "CUSTOM">, string> = {
  FLEXIBLE: resolveCancellationPolicy({ cancellationPolicy: "FLEXIBLE" }).description,
  MODERATE: resolveCancellationPolicy({ cancellationPolicy: "MODERATE" }).description,
  STRICT: resolveCancellationPolicy({ cancellationPolicy: "STRICT" }).description,
  NON_REFUNDABLE: resolveCancellationPolicy({ cancellationPolicy: "NON_REFUNDABLE" }).description,
};

type Props = {
  listingId?: string;
  initialValues?: ListingFormValues;
  /** Where to go after saving - the admin property page when FYStay is preparing a listing. */
  afterSaveHref?: string;
  /**
   * A private draft FYStay is preparing: save whatever is filled in so far
   * (no photo, description or price needed yet). The publication checks
   * still require them before it can go live.
   */
  allowIncomplete?: boolean;
  /** The host has smart pricing on, with FYStay running it ("on"): their commission is the dynamic policy's. */
  smartPriced?: boolean;
};

export function ListingForm({ listingId, initialValues, afterSaveHref = "/host/listings", allowIncomplete = false, smartPriced = false }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<ListingFormValues>(() =>
    initialValues ? withPickerTimes(initialValues) : emptyValues,
  );
  const [legacyTimes, setLegacyTimes] = useState(() => (initialValues ? legacyTimesOf(initialValues) : {}));
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>(
    () => splitAmenities(initialValues?.amenities ?? []).selected,
  );
  const [customAmenities, setCustomAmenities] = useState<string>(
    () => splitAmenities(initialValues?.amenities ?? []).custom,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Picking a time (or removing the old text) replaces a saved free-text time.
  function updateTime(field: ListingTimeField, value: string) {
    setLegacyTimes((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    update(field, value);
  }

  // What each time will be after saving: the untouched older text, or the picker's value.
  const effectiveTime = (field: ListingTimeField) => legacyTimes[field] ?? values[field];
  // Both untouched older values aren't sent at all, so there's nothing to check.
  const quietUntouched = "quietHoursStart" in legacyTimes && "quietHoursEnd" in legacyTimes;
  const quietError = quietUntouched
    ? null
    : quietHoursError(effectiveTime("quietHoursStart"), effectiveTime("quietHoursEnd"));
  const stayError = stayLengthError(values.minNights, values.maxNights);

  // A guest sees the Bedrooms field, not this text - if the two disagree
  // ("2-bedroom apartment" with Bedrooms set to 1), the listing page reads
  // as untrustworthy the moment someone notices. Purely advisory: it never
  // blocks saving, since the description might be right and the number
  // wrong, not the other way round.
  const bedroomMismatch =
    values.description.trim().length > 0 &&
    Number(values.bedrooms) > 0 &&
    hasBedroomCountMismatch(values.description, Number(values.bedrooms));

  function toggleAmenity(amenity: string) {
    setSelectedAmenities((prev) =>
      prev.includes(amenity) ? prev.filter((a) => a !== amenity) : [...prev, amenity],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (values.photos.length === 0 && !allowIncomplete) {
      setError("Add at least one photo.");
      toast.error("Add at least one photo.");
      return;
    }
    if (quietError || stayError) {
      setError(quietError ?? stayError);
      toast.error(quietError ?? stayError);
      return;
    }
    const isHotel = values.propertyType === "HOTEL";
    if (isHotel && !listingId && values.roomTypes.length === 0) {
      setError("Add at least one room type.");
      toast.error("Add at least one room type.");
      return;
    }

    setLoading(true);

    // An untouched older free-text time is left out, so the save keeps it
    // exactly as it was rather than rewriting it.
    const timePayload = (field: ListingTimeField) =>
      field in legacyTimes ? {} : { [field]: values[field] || null };

    const payload = {
      title: values.title,
      description: values.description,
      propertyType: values.propertyType,
      city: values.city,
      country: values.country,
      address: values.address || undefined,
      // A hotel's price/capacity come from its room types (submitted below,
      // create mode only - in edit mode they're managed by RoomTypesEditor
      // hitting their own endpoints, never this form's PATCH).
      ...(isHotel
        ? {}
        : {
            pricePerNightCents: Math.round(Number(values.pricePerNight) * 100),
            weekendPricePerNightCents: values.weekendPricePerNight
              ? Math.round(Number(values.weekendPricePerNight) * 100)
              : null,
            maxGuests: Number(values.maxGuests),
            bedrooms: Number(values.bedrooms),
            beds: Number(values.beds),
            bathrooms: Number(values.bathrooms),
          }),
      securityDepositCents: values.securityDeposit ? Math.round(Number(values.securityDeposit) * 100) : 0,
      weeklyDiscountPercent: values.weeklyDiscountPercent
        ? Number(values.weeklyDiscountPercent)
        : null,
      monthlyDiscountPercent: values.monthlyDiscountPercent
        ? Number(values.monthlyDiscountPercent)
        : null,
      // Both or neither: no percentage means no last-minute deal at all.
      lastMinuteDiscountPercent: values.lastMinuteDiscountPercent
        ? Number(values.lastMinuteDiscountPercent)
        : null,
      lastMinuteWindowDays: values.lastMinuteDiscountPercent
        ? Number(values.lastMinuteWindowDays || LAST_MINUTE_WINDOW_OPTIONS[1])
        : null,
      photos: values.photos,
      ...(isHotel && !listingId ? { roomTypes: values.roomTypes.map(roomTypePayload) } : {}),
      amenities: Array.from(
        new Set([
          ...selectedAmenities,
          ...customAmenities
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
        ]),
      ),
      cancellationPolicy: values.cancellationPolicy,
      ...(values.cancellationPolicy === "CUSTOM"
        ? {
            customCancellationCutoffDays: Number(values.customCancellationCutoffDays),
            customCancellationRefundPercent: Number(values.customCancellationRefundPercent),
          }
        : {}),
      minNights: values.minNights ? Number(values.minNights) : 1,
      maxNights: values.maxNights ? Number(values.maxNights) : null,
      instantBook: values.instantBook,
      ...timePayload("checkInTime"),
      ...timePayload("checkOutTime"),
      selfCheckIn: values.selfCheckIn,
      checkInInstructions: values.checkInInstructions.trim() || null,
      wifiNetwork: values.wifiNetwork.trim() || null,
      wifiPassword: values.wifiPassword.trim() || null,
      smokingAllowed: values.smokingAllowed,
      partiesAllowed: values.partiesAllowed,
      ...timePayload("quietHoursStart"),
      ...timePayload("quietHoursEnd"),
      additionalRules: values.additionalRules.trim() || null,
    };

    let res: Response;
    let data: { error?: string; notice?: string };
    try {
      res = await fetch(listingId ? `/api/listings/${listingId}` : "/api/listings", {
        method: listingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await res.json().catch(() => ({}));
    } catch {
      // Offline or the connection dropped: nothing was saved, and everything
      // typed is still in the form.
      const message = "Couldn't reach FYStay - check your connection and press save again. Nothing you've entered is lost.";
      setError(message);
      setLoading(false);
      toast.error(message);
      return;
    }

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      setLoading(false);
      toast.error(data.error ?? "Something went wrong.");
      return;
    }

    // The server's own explanation when the save changed what guests can
    // see (saved hidden, or sent back to the host for approval).
    if (data.notice) toast.info(data.notice, { duration: 10000 });
    else toast.success(listingId ? "Listing updated" : "Listing created");
    router.push(afterSaveHref);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <SectionHeading icon={Home}>The basics</SectionHeading>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              required
              minLength={3}
              maxLength={120}
              value={values.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="Sunlit loft in the heart of the city"
            />
          </Field>
          <Field>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              required={!allowIncomplete}
              minLength={allowIncomplete ? undefined : 10}
              maxLength={5000}
              rows={5}
              value={values.description}
              onChange={(e) => update("description", e.target.value)}
            />
            {bedroomMismatch && (
              <p className="mt-1.5 flex items-start gap-2 text-sm text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Your description mentions a different bedroom count than the Bedrooms field below
                ({values.bedrooms}). Update whichever one is wrong so guests see consistent
                information.
              </p>
            )}
          </Field>
          <Field>
            <Label htmlFor="propertyType">Property type</Label>
            <Select
              id="propertyType"
              value={values.propertyType}
              onChange={(e) => update("propertyType", e.target.value as PropertyType)}
            >
              {PROPERTY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PROPERTY_TYPE_LABEL[type]}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeading icon={MapPin}>Location</SectionHeading>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                required
                value={values.city}
                onChange={(e) => update("city", e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                required
                value={values.country}
                onChange={(e) => update("country", e.target.value)}
              />
            </Field>
          </div>
          <Field>
            <Label htmlFor="address">Address (optional)</Label>
            <Input
              id="address"
              value={values.address}
              onChange={(e) => update("address", e.target.value)}
            />
            <FieldHint>
              Only shown to guests once they&apos;ve booked, and in their check-in reminder. Leave it
              blank and you&apos;ll need to send each guest the address yourself.
            </FieldHint>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeading icon={Wallet}>
            {values.propertyType === "HOTEL" ? "Stay length" : "Capacity, pricing & stay length"}
          </SectionHeading>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {values.propertyType !== "HOTEL" && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <Label htmlFor="price">Price / night (£)</Label>
                  <Input
                    id="price"
                    required={!allowIncomplete}
                    type="number"
                    min={allowIncomplete ? 0 : 1}
                    max={10000}
                    step="0.01"
                    value={values.pricePerNight}
                    onChange={(e) => update("pricePerNight", e.target.value)}
                    aria-describedby="price-hint"
                  />
                  <p id="price-hint" className="mt-1.5 text-xs text-stone-500">{nightlyEarningsHint(values.pricePerNight, smartPriced)}</p>
                </Field>
                <Field>
                  <Label htmlFor="weekendPrice">Fri &amp; Sat price / night (£, optional)</Label>
                  <Input
                    id="weekendPrice"
                    type="number"
                    min={values.pricePerNight || 1}
                    max={10000}
                    step="0.01"
                    value={values.weekendPricePerNight}
                    onChange={(e) => update("weekendPricePerNight", e.target.value)}
                    placeholder={values.pricePerNight || "Same as weekdays"}
                  />
                  <FieldHint>Charged for Friday and Saturday nights. Leave blank to charge the same every night.</FieldHint>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field>
                  <Label htmlFor="maxGuests">Max guests</Label>
                  <NumberSelect
                    id="maxGuests"
                    value={values.maxGuests}
                    options={countOptions(LISTING_COUNT_RANGES.maxGuests, initialValues?.maxGuests)}
                    onChange={(v) => update("maxGuests", v)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="bedrooms">Bedrooms</Label>
                  <NumberSelect
                    id="bedrooms"
                    value={values.bedrooms}
                    options={countOptions(LISTING_COUNT_RANGES.bedrooms, initialValues?.bedrooms)}
                    onChange={(v) => update("bedrooms", v)}
                    format={(n) => (n === 0 ? "0 (studio)" : String(n))}
                  />
                </Field>
                <Field>
                  <Label htmlFor="beds">Beds</Label>
                  <NumberSelect
                    id="beds"
                    value={values.beds}
                    options={countOptions(LISTING_COUNT_RANGES.beds, initialValues?.beds)}
                    onChange={(v) => update("beds", v)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="bathrooms">Bathrooms</Label>
                  <NumberSelect
                    id="bathrooms"
                    value={values.bathrooms}
                    options={countOptions(LISTING_COUNT_RANGES.bathrooms, initialValues?.bathrooms)}
                    onChange={(v) => update("bathrooms", v)}
                  />
                </Field>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <Label htmlFor="minNights">Minimum stay</Label>
              <NumberSelect
                id="minNights"
                value={values.minNights}
                options={nightOptions(initialValues?.minNights)}
                onChange={(v) => update("minNights", v)}
                format={nightsLabel}
              />
            </Field>
            <Field>
              <Label htmlFor="maxNights">Maximum stay</Label>
              <NumberSelect
                id="maxNights"
                value={values.maxNights}
                options={nightOptions(initialValues?.maxNights)}
                onChange={(v) => update("maxNights", v)}
                format={nightsLabel}
                emptyLabel="No maximum"
                describedBy={stayError ? "maxNights-error" : undefined}
              />
              {stayError && (
                <p id="maxNights-error" role="alert" className="mt-1.5 text-sm text-red-600">
                  {stayError}
                </p>
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeading icon={Percent}>Discounts</SectionHeading>
        </CardHeader>
        <CardContent>
          <ListingDiscounts
            weeklyDiscountPercent={values.weeklyDiscountPercent}
            monthlyDiscountPercent={values.monthlyDiscountPercent}
            lastMinuteDiscountPercent={values.lastMinuteDiscountPercent}
            lastMinuteWindowDays={values.lastMinuteWindowDays}
            pricePerNight={values.pricePerNight}
            weekendPricePerNight={values.weekendPricePerNight}
            isHotel={values.propertyType === "HOTEL"}
            onChange={(key, value) => update(key, value)}
          />
        </CardContent>
      </Card>

      {values.propertyType === "HOTEL" && (
        <Card>
          <CardHeader>
            <SectionHeading icon={Wallet}>Room types</SectionHeading>
            <p className="mt-1 text-sm text-stone-500">
              Each room type has its own price, capacity, photos, and a count of how many
              identical rooms you have.
            </p>
          </CardHeader>
          <CardContent>
            <RoomTypesEditor
              listingId={listingId}
              roomTypes={values.roomTypes}
              onChange={(roomTypes) => update("roomTypes", roomTypes)}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <SectionHeading icon={Camera}>Photos & amenities</SectionHeading>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <Label>{values.propertyType === "HOTEL" ? "Property photos" : "Photos"}</Label>
            <PhotoUploader
              photos={values.photos}
              onChange={(photos) => update("photos", photos)}
            />
            <FieldHint>
              {values.propertyType === "HOTEL"
                ? "The first photo is used as the cover image. Lobby, exterior, and common areas - each room type has its own photos above."
                : "The first photo is used as the cover image."}
            </FieldHint>
          </Field>
          <Field>
            <Label>Amenities</Label>
            <div className="flex flex-wrap gap-2">
              {AMENITY_OPTIONS.map((amenity) => (
                <AmenityCheckbox
                  key={amenity}
                  active={selectedAmenities.includes(amenity)}
                  onClick={() => toggleAmenity(amenity)}
                >
                  {amenity}
                </AmenityCheckbox>
              ))}
            </div>
            <div className="mt-3">
              <Label htmlFor="customAmenities">Other amenities</Label>
              <Input
                id="customAmenities"
                value={customAmenities}
                onChange={(e) => setCustomAmenities(e.target.value)}
                placeholder="Sea view, Garden, EV charger"
              />
              <FieldHint>Comma separated - for anything not listed above.</FieldHint>
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeading icon={ClipboardList}>House rules & check-in</SectionHeading>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <TimeField
              field="checkInTime"
              label="Check-in from"
              value={values.checkInTime}
              legacy={legacyTimes.checkInTime}
              onChange={updateTime}
            />
            <TimeField
              field="checkOutTime"
              label="Checkout by"
              value={values.checkOutTime}
              legacy={legacyTimes.checkOutTime}
              onChange={updateTime}
            />
          </div>

          <Field>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="selfCheckIn" className="mb-0">
                Self check-in
              </Label>
              <AmenityCheckbox active={values.selfCheckIn} onClick={() => update("selfCheckIn", !values.selfCheckIn)}>
                {values.selfCheckIn ? "Guests let themselves in" : "You greet guests"}
              </AmenityCheckbox>
            </div>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="wifiNetwork">Wifi network name (optional)</Label>
              <Input
                id="wifiNetwork"
                value={values.wifiNetwork}
                onChange={(e) => update("wifiNetwork", e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="wifiPassword">Wifi password (optional)</Label>
              <Input
                id="wifiPassword"
                value={values.wifiPassword}
                onChange={(e) => update("wifiPassword", e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <Label htmlFor="checkInInstructions">
              Check-in instructions (optional)
            </Label>
            <Textarea
              id="checkInInstructions"
              rows={3}
              value={values.checkInInstructions}
              onChange={(e) => update("checkInInstructions", e.target.value)}
              placeholder="e.g. Key is in lockbox by the front door, code 4821"
            />
            <FieldHint>
              Only shown to a guest once their booking is paid for - never on the public listing
              page.
            </FieldHint>
          </Field>

          <div className="flex flex-wrap gap-2">
            <AmenityCheckbox
              active={values.smokingAllowed}
              onClick={() => update("smokingAllowed", !values.smokingAllowed)}
            >
              {values.smokingAllowed ? "Smoking allowed" : "No smoking"}
            </AmenityCheckbox>
            <AmenityCheckbox
              active={values.partiesAllowed}
              onClick={() => update("partiesAllowed", !values.partiesAllowed)}
            >
              {values.partiesAllowed ? "Parties allowed" : "No parties or events"}
            </AmenityCheckbox>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-4">
              <TimeField
                field="quietHoursStart"
                label="Quiet hours start (optional)"
                value={values.quietHoursStart}
                legacy={legacyTimes.quietHoursStart}
                onChange={updateTime}
                invalid={Boolean(quietError)}
              />
              <TimeField
                field="quietHoursEnd"
                label="Quiet hours end (optional)"
                value={values.quietHoursEnd}
                legacy={legacyTimes.quietHoursEnd}
                onChange={updateTime}
                invalid={Boolean(quietError)}
              />
            </div>
            {quietError ? (
              <FieldError>{quietError}</FieldError>
            ) : (
              <FieldHint>Overnight is fine - for example 22:00 to 07:00.</FieldHint>
            )}
          </div>

          <Field>
            <Label htmlFor="additionalRules">Additional house rules (optional)</Label>
            <Textarea
              id="additionalRules"
              rows={2}
              value={values.additionalRules}
              onChange={(e) => update("additionalRules", e.target.value)}
              placeholder="e.g. No shoes indoors, recycling goes in the blue bin"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeading icon={Zap}>Booking settings</SectionHeading>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="instantBook" className="mb-0">
                Instant Book
              </Label>
              <AmenityCheckbox
                active={values.instantBook}
                onClick={() => update("instantBook", !values.instantBook)}
              >
                {values.instantBook ? "On - guests book instantly" : "Off - you approve each request"}
              </AmenityCheckbox>
            </div>
            <FieldHint>
              With Instant Book off, a guest submits a request instead of paying right away - you
              have 24 hours to accept or decline before it expires automatically.
            </FieldHint>
          </Field>

          <Field>
            <Label htmlFor="securityDeposit">Security deposit (£, optional)</Label>
            <Input
              id="securityDeposit"
              type="number"
              min="0"
              max="5000"
              step="1"
              value={values.securityDeposit}
              onChange={(e) => update("securityDeposit", e.target.value)}
              placeholder="0"
            />
            <FieldHint>
              A refundable hold on the guest&apos;s card, placed the day before check-in - never
              charged unless you claim within 3 days of checkout. Card holds usually last a week, so
              for stays longer than about 5 nights the time to claim can be shorter or gone: the
              booking shows your exact claim deadline.
            </FieldHint>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeading icon={ShieldCheck}>Cancellation policy</SectionHeading>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="cancellationPolicy">Refund rules for guest cancellations</Label>
            <Select
              id="cancellationPolicy"
              value={values.cancellationPolicy}
              onChange={(e) =>
                update("cancellationPolicy", e.target.value as CancellationPolicyKind)
              }
            >
              <option value="FLEXIBLE">Flexible</option>
              <option value="MODERATE">Moderate</option>
              <option value="STRICT">Strict</option>
              <option value="NON_REFUNDABLE">Non-refundable</option>
              <option value="CUSTOM">Custom</option>
            </Select>
            <FieldHint>
              {values.cancellationPolicy === "CUSTOM"
                ? "Set your own cutoff and refund percentage below."
                : POLICY_PREVIEWS[values.cancellationPolicy]}
            </FieldHint>
          </Field>

          {values.cancellationPolicy === "CUSTOM" && (
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <Label htmlFor="customCutoff">Full-refund cutoff (days before check-in)</Label>
                <Input
                  id="customCutoff"
                  type="number"
                  min={0}
                  max={90}
                  value={values.customCancellationCutoffDays}
                  onChange={(e) => update("customCancellationCutoffDays", e.target.value)}
                />
              </Field>
              <Field>
                <Label htmlFor="customPercent">Refund percentage before cutoff</Label>
                <Input
                  id="customPercent"
                  type="number"
                  min={0}
                  max={100}
                  value={values.customCancellationRefundPercent}
                  onChange={(e) => update("customCancellationRefundPercent", e.target.value)}
                />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button type="submit" loading={loading} size="lg" className="self-start">
        {listingId ? "Save changes" : "Create listing"}
      </Button>
    </form>
  );
}

/**
 * A native time picker (the iPhone wheel, a desktop hh:mm box). A saved
 * free-text time from before the picker is shown underneath, exactly as
 * guests see it, and stays as it is until the host picks a time or removes
 * it - never rewritten just because the form was saved.
 */
function TimeField({
  field,
  label,
  value,
  legacy,
  onChange,
  invalid = false,
}: {
  field: ListingTimeField;
  label: string;
  value: string;
  legacy?: string;
  onChange: (field: ListingTimeField, value: string) => void;
  invalid?: boolean;
}) {
  const hintId = `${field}-legacy`;
  return (
    <Field>
      <Label htmlFor={field}>{label}</Label>
      <Input
        id={field}
        type="time"
        value={value}
        invalid={invalid}
        onChange={(e) => onChange(field, e.target.value)}
        aria-describedby={legacy ? hintId : undefined}
      />
      {legacy !== undefined ? (
        <p id={hintId} className="mt-1.5 text-xs text-stone-500">
          Guests currently see &ldquo;{legacy}&rdquo;. That stays as it is until you pick a new time, or{" "}
          <button type="button" className="focus-ring rounded font-medium text-brand-700 underline" onClick={() => onChange(field, "")}>
            remove it
          </button>
          .
        </p>
      ) : (
        value && <p className="mt-1.5 text-xs text-stone-500">Guests see {formatListingTime(value)}.</p>
      )}
    </Field>
  );
}

/**
 * What a host keeps from their nightly price, shown under the price box so
 * the commission is never a surprise: guests pay exactly this price, and
 * FYStay's commission (the fixed rate, pricingPolicy.ts) comes out of it.
 */
function nightlyEarningsHint(pricePerNight: string, smartPriced: boolean): string {
  const cents = Math.round(Number(pricePerNight) * 100);
  if (!Number.isFinite(cents) || cents <= 0) {
    return `Include cleaning - there's no separate cleaning fee. Guests pay this price; FYStay keeps ${formatRate(LEGACY_FIXED_10.baseRateBps)}.`;
  }
  const pounds = (c: number) => `£${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
  return `Guests pay ${pounds(cents)} a night. You receive ${pounds(cents - hostCommissionFor(cents))} after FYStay's ${formatRate(LEGACY_FIXED_10.baseRateBps)}${smartPriced ? ` - or after ${commissionRangeText(CURRENT_DYNAMIC_POLICY)}, worked out per booking, while smart pricing is on (see Smart pricing below)` : ""}. Include cleaning in this price.`;
}
