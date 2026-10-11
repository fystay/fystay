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

type HostOption = { id: string; name: string; email: string; suspended: boolean };

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
export function AddPropertyForm({ hosts, searched }: { hosts: HostOption[]; searched: boolean }) {
  const router = useRouter();
  const [ownerKind, setOwnerKind] = useState<"existing" | "invite">(hosts.length > 0 ? "existing" : "invite");
  const [hostId, setHostId] = useState<string>(hosts.find((h) => !h.suspended)?.id ?? "");
  const [invite, setInvite] = useState({ name: "", email: "", phone: "", consentNote: "" });
  const [property, setProperty] = useState({ title: "", city: "", propertyType: "HOUSE" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    toast.success("Draft started - add the details next.");
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
          </Field>
        </div>
      </fieldset>

      <div>
        <FieldError>{error}</FieldError>
        <Button type="submit" disabled={busy} className="mt-2">
          {busy ? "Starting draft…" : "Start private draft"}
        </Button>
      </div>
    </form>
  );
}
