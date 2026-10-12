"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Label";
import { cn } from "@/lib/cn";
import { AMENITY_OPTIONS } from "@/lib/amenityOptions";
import type { ImportedListingDraft, ListingImportResult } from "@/lib/listingImport";

type HostOption = { id: string; name: string; email: string; suspended: boolean };

type Details = {
  description: string;
  address: string;
  bedrooms: string;
  bathrooms: string;
  maxGuests: string;
  price: string;
  amenities: string[];
  houseRules: string;
};

const EMPTY_DETAILS: Details = {
  description: "",
  address: "",
  bedrooms: "",
  bathrooms: "",
  maxGuests: "",
  price: "",
  amenities: [],
  houseRules: "",
};

function detailsFrom(draft: ImportedListingDraft): Details {
  const n = (v: number | null) => (v === null ? "" : String(v));
  return {
    description: draft.description ?? "",
    address: draft.address ?? "",
    bedrooms: n(draft.bedrooms),
    bathrooms: n(draft.bathrooms),
    maxGuests: n(draft.maxGuests),
    price: draft.pricePerNightCents === null ? "" : (draft.pricePerNightCents / 100).toFixed(2).replace(/\.00$/, ""),
    amenities: draft.amenities,
    houseRules: draft.houseRules ?? "",
  };
}

/** The import's flag for a field: why it's missing or uncertain, if it is. */
function flagFor(result: ListingImportResult | null, ...fields: string[]): string | null {
  if (!result) return null;
  const uncertain = result.uncertain.find((u) => fields.includes(u.field));
  if (uncertain) return `Check this: ${uncertain.note}`;
  if (result.missing.some((m) => fields.includes(m))) return "Not in the source - fill it in, or leave it for the owner.";
  return null;
}

function Flag({ children }: { children: string | null }) {
  if (!children) return null;
  return <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">{children}</p>;
}

const TYPES = [
  ["HOUSE", "House"],
  ["APARTMENT", "Apartment"],
  ["COTTAGE", "Cottage"],
  ["VILLA", "Villa"],
  ["STUDIO", "Studio"],
  ["HOTEL", "Hotel"],
  ["OTHER", "Other"],
] as const;

/**
 * Step two of "Add a property": pick the owner (a host found by the search
 * above, or a new owner to invite) and start the draft. Inviting records
 * only what's needed to reach the owner, plus how they agreed to be
 * contacted; it doesn't email anyone - that's a separate, explicit step on
 * the draft once it's ready.
 */
export function AddPropertyForm({
  hosts,
  searched,
  importEnabled = false,
}: {
  hosts: HostOption[];
  searched: boolean;
  /** Show "Import from an existing listing" (needs ANTHROPIC_API_KEY). */
  importEnabled?: boolean;
}) {
  const router = useRouter();
  const [ownerKind, setOwnerKind] = useState<"existing" | "invite">(hosts.length > 0 ? "existing" : "invite");
  const [hostId, setHostId] = useState<string>(hosts.find((h) => !h.suspended)?.id ?? "");
  const [invite, setInvite] = useState({ name: "", email: "", phone: "", consentNote: "" });
  const [property, setProperty] = useState({ title: "", city: "", propertyType: "HOUSE" });
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [imported, setImported] = useState<ListingImportResult | null>(null);
  const [importSource, setImportSource] = useState({ url: "", text: "" });
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runImport() {
    setImportError(null);
    setImporting(true);
    const res = await fetch("/api/admin/properties/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: importSource.url.trim() || undefined, text: importSource.text.trim() || undefined }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (ListingImportResult & { error?: string }) | null;
    setImporting(false);
    if (!res?.ok || !data?.draft) {
      setImportError(data?.error ?? "Couldn't reach FYStay - check your connection and try again.");
      return;
    }
    setImported(data);
    setProperty((p) => ({
      title: data.draft.title ?? p.title,
      city: data.draft.city ?? p.city,
      propertyType: data.draft.propertyType ?? p.propertyType,
    }));
    setDetails(detailsFrom(data.draft));
    toast.success("Listing read - check every field before saving.");
  }

  function detailsPayload() {
    if (!imported) return undefined;
    const int = (v: string) => (v.trim() === "" ? undefined : Math.round(Number(v)));
    const price = details.price.trim() === "" ? undefined : Math.round(Number(details.price) * 100);
    return {
      description: details.description.trim() || undefined,
      address: details.address.trim() || undefined,
      bedrooms: int(details.bedrooms),
      bathrooms: int(details.bathrooms),
      maxGuests: int(details.maxGuests),
      pricePerNightCents: price,
      amenities: details.amenities,
      additionalRules: details.houseRules.trim() || undefined,
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (ownerKind === "existing" && !hostId) {
      setError("Choose the host who owns the property, or invite a new owner.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/admin/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...property,
        details: detailsPayload(),
        host:
          ownerKind === "existing"
            ? { kind: "existing", userId: hostId }
            : { kind: "invite", ...invite, phone: invite.phone || undefined },
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string; listing?: { id: string } } | null;
    setBusy(false);
    if (!res?.ok || !data?.listing) {
      setError(data?.error ?? "Couldn't reach FYStay - check your connection and try again.");
      return;
    }
    toast.success(imported ? "Saved as a private draft - add photos next." : "Draft started - add the details next.");
    router.push(`/admin/properties/${data.listing.id}/edit`);
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-8">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Owner</legend>
        {hosts.length > 0 && (
          <div className="flex flex-col gap-2">
            {hosts.map((host) => (
              <label
                key={host.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm",
                  ownerKind === "existing" && hostId === host.id ? "border-brand-600 bg-brand-50" : "border-border-subtle",
                  host.suspended && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="owner"
                  disabled={host.suspended}
                  checked={ownerKind === "existing" && hostId === host.id}
                  onChange={() => {
                    setOwnerKind("existing");
                    setHostId(host.id);
                  }}
                />
                <span>
                  <span className="font-medium text-foreground">{host.name}</span>{" "}
                  <span className="text-stone-600">{host.email}</span>
                  {host.suspended && <span className="text-red-700"> · suspended</span>}
                </span>
              </label>
            ))}
          </div>
        )}
        {searched && hosts.length === 0 && <p className="text-sm text-stone-600">No host matches that search.</p>}
        <label
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm",
            ownerKind === "invite" ? "border-brand-600 bg-brand-50" : "border-border-subtle",
          )}
        >
          <input type="radio" name="owner" checked={ownerKind === "invite"} onChange={() => setOwnerKind("invite")} />
          <span className="font-medium text-foreground">The owner isn&apos;t a FYStay host yet - invite them</span>
        </label>

        {ownerKind === "invite" && (
          <div className="flex flex-col gap-4 rounded-xl border border-border-subtle p-4">
            <Field>
              <Label htmlFor="invite-name">Owner&apos;s name</Label>
              <Input id="invite-name" required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
            </Field>
            <Field>
              <Label htmlFor="invite-email">Owner&apos;s email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              />
              <FieldHint>
                Only someone signed in with this address, once it&apos;s confirmed, can take over the draft.
              </FieldHint>
            </Field>
            <Field>
              <Label htmlFor="invite-phone">Phone (optional)</Label>
              <Input id="invite-phone" type="tel" value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} />
            </Field>
            <Field>
              <Label htmlFor="invite-consent">How did the owner agree to FYStay contacting them about listing?</Label>
              <Textarea
                id="invite-consent"
                required
                rows={2}
                placeholder="e.g. Phone call with the owner on 9 October; they asked us to prepare the listing"
                value={invite.consentNote}
                onChange={(e) => setInvite({ ...invite, consentNote: e.target.value })}
              />
              <FieldHint>Kept with the invitation as the record of their permission.</FieldHint>
            </Field>
          </div>
        )}
      </fieldset>

      {importEnabled && (
        <section className="flex flex-col gap-3 rounded-xl border border-border-subtle p-4">
          <h2 className="text-base font-semibold text-foreground">Import from an existing listing (optional)</h2>
          <p className="text-sm text-stone-600">
            Paste a link to the owner&apos;s public listing (Airbnb, Booking.com, Vrbo, Hostaway...) or paste the listing
            text. FYStay only reads public pages that allow it; if a page is blocked or needs signing in, paste the
            details instead. Nothing is saved until you press Save below.
          </p>
          <Field>
            <Label htmlFor="import-url">Public listing link</Label>
            <Input
              id="import-url"
              type="url"
              placeholder="https://"
              value={importSource.url}
              onChange={(e) => setImportSource({ ...importSource, url: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor="import-text">Or paste the listing details</Label>
            <Textarea
              id="import-text"
              rows={5}
              maxLength={20000}
              value={importSource.text}
              onChange={(e) => setImportSource({ ...importSource, text: e.target.value })}
            />
            <FieldHint>Pasted text is used instead of the link when both are given.</FieldHint>
          </Field>
          <FieldError>{importError}</FieldError>
          <div>
            <Button
              type="button"
              variant="outline"
              loading={importing}
              disabled={!importSource.url.trim() && importSource.text.trim().length < 50}
              onClick={runImport}
            >
              Read listing
            </Button>
          </div>
          {imported && (
            <p role="status" className="text-sm text-stone-700">
              Read. {imported.missing.length + imported.uncertain.length > 0
                ? "Fields marked in amber were missing or uncertain - nothing has been guessed."
                : "Check each field below before saving."}
            </p>
          )}
        </section>
      )}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-lg font-semibold text-foreground">2. The property</legend>
        <Field>
          <Label htmlFor="property-title">Working title</Label>
          <Input
            id="property-title"
            required
            value={property.title}
            onChange={(e) => setProperty({ ...property, title: e.target.value })}
          />
          <Flag>{flagFor(imported, "title")}</Flag>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label htmlFor="property-city">Town</Label>
            <Input
              id="property-city"
              required
              value={property.city}
              onChange={(e) => setProperty({ ...property, city: e.target.value })}
            />
            <Flag>{flagFor(imported, "city")}</Flag>
          </Field>
          <Field>
            <Label htmlFor="property-type">Property type</Label>
            <Select
              id="property-type"
              value={property.propertyType}
              onChange={(e) => setProperty({ ...property, propertyType: e.target.value })}
            >
              {TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Flag>{flagFor(imported, "propertyType")}</Flag>
          </Field>
        </div>
        {imported && <ImportedDetailsFields details={details} setDetails={setDetails} imported={imported} />}
      </fieldset>

      <div>
        <FieldError>{error}</FieldError>
        <Button type="submit" disabled={busy} className="mt-2">
          {busy ? "Saving…" : imported ? "Save as private draft" : "Start private draft"}
        </Button>
      </div>
    </form>
  );
}

/** The extra fields an import fills in, editable before anything is saved. */
function ImportedDetailsFields({
  details,
  setDetails,
  imported,
}: {
  details: Details;
  setDetails: (next: Details) => void;
  imported: ListingImportResult;
}) {
  const set = (key: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDetails({ ...details, [key]: e.target.value });
  return (
    <>
      <Field>
        <Label htmlFor="import-description">Description</Label>
        <Textarea id="import-description" rows={6} maxLength={5000} value={details.description} onChange={set("description")} />
        <Flag>{flagFor(imported, "description")}</Flag>
      </Field>
      <Field>
        <Label htmlFor="import-address">Address (only shown to guests once booked)</Label>
        <Input id="import-address" maxLength={200} value={details.address} onChange={set("address")} />
        <Flag>{flagFor(imported, "address")}</Flag>
      </Field>
      <div className="grid gap-4 sm:grid-cols-4">
        {(
          [
            ["bedrooms", "Bedrooms", 0],
            ["bathrooms", "Bathrooms", 0],
            ["maxGuests", "Max guests", 1],
          ] as const
        ).map(([key, label, min]) => (
          <Field key={key}>
            <Label htmlFor={`import-${key}`}>{label}</Label>
            <Input id={`import-${key}`} type="number" min={min} max={50} step={1} value={details[key]} onChange={set(key)} />
            <Flag>{flagFor(imported, key)}</Flag>
          </Field>
        ))}
        <Field>
          <Label htmlFor="import-price">Price per night (£)</Label>
          <Input id="import-price" type="number" min={1} max={10000} step="0.01" value={details.price} onChange={set("price")} />
          <Flag>{flagFor(imported, "pricePerNightCents", "pricePerNight", "price")}</Flag>
        </Field>
      </div>
      <Field>
        <span className="mb-1.5 block text-sm font-medium text-foreground">Amenities</span>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {AMENITY_OPTIONS.map((amenity) => (
            <label key={amenity} className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={details.amenities.includes(amenity)}
                onChange={(e) =>
                  setDetails({
                    ...details,
                    amenities: e.target.checked
                      ? [...details.amenities, amenity]
                      : details.amenities.filter((a) => a !== amenity),
                  })
                }
              />
              {amenity}
            </label>
          ))}
        </div>
        <Flag>{flagFor(imported, "amenities")}</Flag>
      </Field>
      <Field>
        <Label htmlFor="import-rules">House rules</Label>
        <Textarea id="import-rules" rows={3} maxLength={2000} value={details.houseRules} onChange={set("houseRules")} />
        <Flag>{flagFor(imported, "houseRules")}</Flag>
      </Field>
    </>
  );
}
