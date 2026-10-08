"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Camera, ClipboardList, Home, MapPin, ShieldCheck, Wallet, Zap } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Field, FieldHint, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { LAST_MINUTE_MAX_PERCENT, LAST_MINUTE_MIN_PERCENT, LAST_MINUTE_WINDOW_OPTIONS } from "@/lib/deals";
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
import { cn } from "@/lib/cn";

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

export type ListingFormValues = {
  title: string;
  description: string;
  propertyType: PropertyType;
  city: string;
  country: string;
  address: string;
  pricePerNight: string;
  cleaningFee: string;
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
  cleaningFee: "",
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
  checkInTime: "",
  checkOutTime: "",
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

// A curated checklist covering the amenities guests actually filter by
// (worded to match the regex categories in amenityCategories.ts, so ticking
// one here is guaranteed to be found by that filter) plus other common
// short-stay amenities. Anything a host has that isn't on this list still
// has a home in the free-text "Other amenities" field below it.
const AMENITY_OPTIONS = [
  "Wifi",
  "Free parking",
  "Kitchen",
  "Washer",
  "Dryer",
  "Air conditioning",
  "Heating",
  "TV",
  "Pool",
  "Hot tub",
  "Gym",
  "Pet friendly",
  "Step-free entrance",
  "Wide doorways",
  "Accessible bathroom",
  "Elevator access",
  "Accessible parking",
  "Sea view",
  "Garden",
  "Balcony",
  "BBQ grill",
  "Fireplace",
  "Dedicated workspace",
  "EV charger",
];

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
};

type Props = {
  listingId?: string;
  initialValues?: ListingFormValues;
};

export function ListingForm({ listingId, initialValues }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<ListingFormValues>(initialValues ?? emptyValues);
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

    if (values.photos.length === 0) {
      setError("Add at least one photo.");
      toast.error("Add at least one photo.");
      return;
    }
    const isHotel = values.propertyType === "HOTEL";
    if (isHotel && !listingId && values.roomTypes.length === 0) {
      setError("Add at least one room type.");
      toast.error("Add at least one room type.");
      return;
    }

    setLoading(true);

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
            maxGuests: Number(values.maxGuests),
            bedrooms: Number(values.bedrooms),
            beds: Number(values.beds),
            bathrooms: Number(values.bathrooms),
          }),
      cleaningFeeCents: values.cleaningFee ? Math.round(Number(values.cleaningFee) * 100) : 0,
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
      checkInTime: values.checkInTime.trim() || null,
      checkOutTime: values.checkOutTime.trim() || null,
      selfCheckIn: values.selfCheckIn,
      checkInInstructions: values.checkInInstructions.trim() || null,
      wifiNetwork: values.wifiNetwork.trim() || null,
      wifiPassword: values.wifiPassword.trim() || null,
      smokingAllowed: values.smokingAllowed,
      partiesAllowed: values.partiesAllowed,
      quietHoursStart: values.quietHoursStart.trim() || null,
      quietHoursEnd: values.quietHoursEnd.trim() || null,
      additionalRules: values.additionalRules.trim() || null,
    };

    let res: Response;
    let data: { error?: string };
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

    toast.success(listingId ? "Listing updated" : "Listing created");
    router.push("/host/listings");
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
              required
              minLength={10}
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
            {values.propertyType === "HOTEL" ? "Fees, discounts & stay length" : "Capacity & pricing"}
          </SectionHeading>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {values.propertyType !== "HOTEL" && (
              <Field>
                <Label htmlFor="price">Price / night (£)</Label>
                <Input
                  id="price"
                  required
                  type="number"
                  min={1}
                  max={10000}
                  step="0.01"
                  value={values.pricePerNight}
                  onChange={(e) => update("pricePerNight", e.target.value)}
                />
              </Field>
            )}
            <Field>
              <Label htmlFor="cleaningFee">Cleaning fee (£, optional)</Label>
              <Input
                id="cleaningFee"
                type="number"
                min={0}
                max={1000}
                step="0.01"
                value={values.cleaningFee}
                onChange={(e) => update("cleaningFee", e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field>
              <Label htmlFor="weeklyDiscountPercent">Weekly discount % (optional)</Label>
              <Input
                id="weeklyDiscountPercent"
                type="number"
                min={0}
                max={90}
                value={values.weeklyDiscountPercent}
                onChange={(e) => update("weeklyDiscountPercent", e.target.value)}
                placeholder="0"
              />
              <FieldHint>Applied to stays of 7+ nights.</FieldHint>
            </Field>
            <Field>
              <Label htmlFor="monthlyDiscountPercent">Monthly discount % (optional)</Label>
              <Input
                id="monthlyDiscountPercent"
                type="number"
                min={0}
                max={90}
                value={values.monthlyDiscountPercent}
                onChange={(e) => update("monthlyDiscountPercent", e.target.value)}
                placeholder="0"
              />
              <FieldHint>Applied to stays of 28+ nights.</FieldHint>
            </Field>
            <Field>
              <Label htmlFor="lastMinuteDiscountPercent">Last-minute deal % (optional)</Label>
              <Input
                id="lastMinuteDiscountPercent"
                type="number"
                min={LAST_MINUTE_MIN_PERCENT}
                max={LAST_MINUTE_MAX_PERCENT}
                value={values.lastMinuteDiscountPercent}
                onChange={(e) => update("lastMinuteDiscountPercent", e.target.value)}
                placeholder="e.g. 15"
              />
              <FieldHint>
                Off stays that start soon - featured in Last Minute Deals on the homepage. Doesn&apos;t stack
                with weekly or monthly discounts; guests get the larger one.
              </FieldHint>
            </Field>
            <Field>
              <Label htmlFor="lastMinuteWindowDays">Last-minute deal applies to check-ins within</Label>
              <Select
                id="lastMinuteWindowDays"
                value={values.lastMinuteWindowDays || String(LAST_MINUTE_WINDOW_OPTIONS[1])}
                onChange={(e) => update("lastMinuteWindowDays", e.target.value)}
                disabled={!values.lastMinuteDiscountPercent}
              >
                {LAST_MINUTE_WINDOW_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </Select>
            </Field>
            {values.propertyType !== "HOTEL" && (
              <>
                <Field>
                  <Label htmlFor="maxGuests">Max guests</Label>
                  <Input
                    id="maxGuests"
                    required
                    type="number"
                    min={1}
                    value={values.maxGuests}
                    onChange={(e) => update("maxGuests", e.target.value)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="bedrooms">Bedrooms</Label>
                  <Input
                    id="bedrooms"
                    required
                    type="number"
                    min={0}
                    value={values.bedrooms}
                    onChange={(e) => update("bedrooms", e.target.value)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="beds">Beds</Label>
                  <Input
                    id="beds"
                    required
                    type="number"
                    min={1}
                    value={values.beds}
                    onChange={(e) => update("beds", e.target.value)}
                  />
                </Field>
                <Field>
                  <Label htmlFor="bathrooms">Bathrooms</Label>
                  <Input
                    id="bathrooms"
                    required
                    type="number"
                    min={0}
                    value={values.bathrooms}
                    onChange={(e) => update("bathrooms", e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field>
              <Label htmlFor="minNights">Minimum nights</Label>
              <Input
                id="minNights"
                required
                type="number"
                min={1}
                value={values.minNights}
                onChange={(e) => update("minNights", e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="maxNights">Maximum nights (optional)</Label>
              <Input
                id="maxNights"
                type="number"
                min={1}
                value={values.maxNights}
                onChange={(e) => update("maxNights", e.target.value)}
                placeholder="No limit"
              />
            </Field>
          </div>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="checkInTime">Check-in time</Label>
              <Input
                id="checkInTime"
                value={values.checkInTime}
                onChange={(e) => update("checkInTime", e.target.value)}
                placeholder="After 3:00 PM"
              />
            </Field>
            <Field>
              <Label htmlFor="checkOutTime">Checkout time</Label>
              <Input
                id="checkOutTime"
                value={values.checkOutTime}
                onChange={(e) => update("checkOutTime", e.target.value)}
                placeholder="Before 11:00 AM"
              />
            </Field>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <Label htmlFor="quietHoursStart">Quiet hours start (optional)</Label>
              <Input
                id="quietHoursStart"
                value={values.quietHoursStart}
                onChange={(e) => update("quietHoursStart", e.target.value)}
                placeholder="10:00 PM"
              />
            </Field>
            <Field>
              <Label htmlFor="quietHoursEnd">Quiet hours end (optional)</Label>
              <Input
                id="quietHoursEnd"
                value={values.quietHoursEnd}
                onChange={(e) => update("quietHoursEnd", e.target.value)}
                placeholder="8:00 AM"
              />
            </Field>
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
