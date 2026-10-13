"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusCircle, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Field, FieldHint, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { PhotoUploader } from "@/components/PhotoUploader";
import { countOptions, LISTING_COUNT_RANGES } from "@/lib/listingFormOptions";

export type RoomTypeFormValues = {
  // Unset for a draft that hasn't been saved yet - in create mode, that's
  // every room type until the whole listing is created; in edit mode, only
  // a freshly-added-but-not-yet-saved row.
  id?: string;
  name: string;
  description: string;
  pricePerNight: string;
  maxGuests: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  photos: string[];
  totalRooms: string;
};

export const emptyRoomType: RoomTypeFormValues = {
  name: "",
  description: "",
  pricePerNight: "",
  maxGuests: "2",
  bedrooms: "1",
  beds: "1",
  bathrooms: "1",
  photos: [],
  totalRooms: "1",
};

export function roomTypePayload(roomType: RoomTypeFormValues) {
  return {
    name: roomType.name,
    description: roomType.description.trim() || null,
    pricePerNightCents: Math.round(Number(roomType.pricePerNight) * 100),
    maxGuests: Number(roomType.maxGuests),
    bedrooms: Number(roomType.bedrooms),
    beds: Number(roomType.beds),
    bathrooms: Number(roomType.bathrooms),
    photos: roomType.photos,
    totalRooms: Number(roomType.totalRooms),
  };
}

/**
 * Add/edit/remove a HOTEL listing's room types. In create mode (no
 * listingId yet) this only manages local draft state - the whole array
 * submits as part of the listing's own POST /api/listings, the same as any
 * other field on that form. In edit mode, each add/save/remove instead
 * calls its own room-types endpoint directly (the same pattern as
 * AvailabilityBlock mutations being separate from the listing PATCH), so a
 * room type with real bookings stays protected regardless of what the rest
 * of the form is doing.
 */
export function RoomTypesEditor({
  listingId,
  roomTypes,
  onChange,
}: {
  listingId?: string;
  roomTypes: RoomTypeFormValues[];
  onChange: (roomTypes: RoomTypeFormValues[]) => void;
}) {
  const router = useRouter();
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  function updateAt(index: number, patch: Partial<RoomTypeFormValues>) {
    onChange(roomTypes.map((rt, i) => (i === index ? { ...rt, ...patch } : rt)));
  }

  function addDraft() {
    onChange([...roomTypes, { ...emptyRoomType }]);
  }

  async function saveAt(index: number) {
    if (!listingId) return; // Create mode: nothing to save until the whole form submits.
    const roomType = roomTypes[index];
    const isNew = !roomType.id;

    setSavingIndex(index);
    const res = await fetch(
      isNew
        ? `/api/listings/${listingId}/room-types`
        : `/api/listings/${listingId}/room-types/${roomType.id}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roomTypePayload(roomType)),
      },
    );
    const data = await res.json();
    setSavingIndex(null);

    if (!res.ok) {
      toast.error(data.error ?? "Could not save this room type.");
      return;
    }

    updateAt(index, { id: data.roomType.id });
    toast.success(isNew ? "Room type added" : "Room type updated");
    router.refresh();
  }

  async function removeAt(index: number) {
    const roomType = roomTypes[index];

    if (!listingId || !roomType.id) {
      // A draft that was never saved to the server - just drop it locally.
      setRemoveIndex(null);
      onChange(roomTypes.filter((_, i) => i !== index));
      return;
    }

    setRemoving(true);
    const res = await fetch(`/api/listings/${listingId}/room-types/${roomType.id}`, {
      method: "DELETE",
    });
    setRemoving(false);
    setRemoveIndex(null);

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Could not remove this room type.");
      return;
    }
    onChange(roomTypes.filter((_, i) => i !== index));
    toast.success("Room type removed");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {roomTypes.map((roomType, index) => (
        <Card key={roomType.id ?? `draft-${index}`} className="border-dashed">
          <CardContent className="flex flex-col gap-4 pt-5">
            <Field>
              <Label htmlFor={`rt-name-${index}`}>Room type name</Label>
              <Input
                id={`rt-name-${index}`}
                required
                value={roomType.name}
                onChange={(e) => updateAt(index, { name: e.target.value })}
                placeholder="Standard Double"
              />
            </Field>

            <Field>
              <Label htmlFor={`rt-description-${index}`}>Description (optional)</Label>
              <Textarea
                id={`rt-description-${index}`}
                rows={2}
                value={roomType.description}
                onChange={(e) => updateAt(index, { description: e.target.value })}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Field>
                <Label htmlFor={`rt-price-${index}`}>Price / night (£)</Label>
                <Input
                  id={`rt-price-${index}`}
                  required
                  type="number"
                  min={1}
                  step="0.01"
                  value={roomType.pricePerNight}
                  onChange={(e) => updateAt(index, { pricePerNight: e.target.value })}
                />
              </Field>
              <Field>
                <Label htmlFor={`rt-total-${index}`}>Number of rooms</Label>
                <Input
                  id={`rt-total-${index}`}
                  required
                  type="number"
                  min={roomType.id ? 0 : 1}
                  value={roomType.totalRooms}
                  onChange={(e) => updateAt(index, { totalRooms: e.target.value })}
                />
                <FieldHint>Identical rooms of this type.</FieldHint>
              </Field>
              <Field>
                <Label htmlFor={`rt-guests-${index}`}>Max guests</Label>
                <Select
                  id={`rt-guests-${index}`}
                  required
                  value={roomType.maxGuests}
                  onChange={(e) => updateAt(index, { maxGuests: e.target.value })}
                >
                  {countOptions(LISTING_COUNT_RANGES.maxGuests, roomType.maxGuests).map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label htmlFor={`rt-bedrooms-${index}`}>Bedrooms</Label>
                <Select
                  id={`rt-bedrooms-${index}`}
                  required
                  value={roomType.bedrooms}
                  onChange={(e) => updateAt(index, { bedrooms: e.target.value })}
                >
                  {countOptions(LISTING_COUNT_RANGES.bedrooms, roomType.bedrooms).map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label htmlFor={`rt-beds-${index}`}>Beds</Label>
                <Select
                  id={`rt-beds-${index}`}
                  required
                  value={roomType.beds}
                  onChange={(e) => updateAt(index, { beds: e.target.value })}
                >
                  {countOptions(LISTING_COUNT_RANGES.beds, roomType.beds).map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label htmlFor={`rt-bathrooms-${index}`}>Bathrooms</Label>
                <Select
                  id={`rt-bathrooms-${index}`}
                  required
                  value={roomType.bathrooms}
                  onChange={(e) => updateAt(index, { bathrooms: e.target.value })}
                >
                  {countOptions(LISTING_COUNT_RANGES.bathrooms, roomType.bathrooms).map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field>
              <Label>Photos</Label>
              <PhotoUploader
                photos={roomType.photos}
                onChange={(photos) => updateAt(index, { photos })}
              />
            </Field>

            <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={() => setRemoveIndex(index)}
                className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
              {listingId && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={savingIndex === index}
                  onClick={() => saveAt(index)}
                >
                  {roomType.id ? "Save changes" : "Add room type"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <Button type="button" variant="outline" onClick={addDraft} className="self-start">
        <PlusCircle className="h-4 w-4" />
        Add room type
      </Button>

      <ConfirmDialog
        open={removeIndex !== null}
        onClose={() => setRemoveIndex(null)}
        onConfirm={() => removeIndex !== null && removeAt(removeIndex)}
        danger
        loading={removing}
        title="Remove room type"
        description="Remove this room type? Room types with existing bookings can't be removed."
        confirmLabel="Remove"
      />
    </div>
  );
}
