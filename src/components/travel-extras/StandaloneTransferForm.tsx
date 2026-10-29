"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";
import { trackAddonEvent } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { MIN_TRANSFER_NOTICE_HOURS } from "@/lib/transferJourney";

/** datetime-local's own format (local time, no zone) for "now plus N hours". */
function localInputValue(hoursAhead: number): string {
  const d = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Books an airport transfer with no stay: the journey, who to contact, then
 * the same Stripe checkout every other FYStay payment uses. Signed-out
 * guests are sent to sign in and brought straight back.
 */
export function StandaloneTransferForm({
  offering,
  signedIn,
  defaultName,
  defaultPhone,
}: {
  offering: { id: string; name: string; priceCents: number; providerName: string };
  signedIn: boolean;
  defaultName: string;
  defaultPhone: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    const back = encodeURIComponent("/travel-extras?category=AIRPORT_TRANSFER");
    return (
      <div className="flex flex-col gap-3">
        <Link
          href={`/login?callbackUrl=${back}`}
          onClick={() => trackAddonEvent({ name: "transfer_offer_clicked", category: "AIRPORT_TRANSFER", surface: "travel_extras_landing", offeringId: offering.id })}
          className={cn(buttonVariants({ size: "lg" }), "justify-center")}
        >
          Sign in to book
        </Link>
        <p className="text-center text-xs text-stone-500">
          New to FYStay?{" "}
          <Link href={`/register?callbackUrl=${back}`} className="font-medium text-brand-700 underline underline-offset-2">
            Create an account
          </Link>{" "}
          - you can book a transfer without booking a stay.
        </p>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const pickupLocal = text("pickupAt");
    if (!pickupLocal) {
      setError("Choose the pickup date and time.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/extras/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offeringId: offering.id,
          pickupAddress: text("pickupAddress"),
          dropoffAddress: text("dropoffAddress"),
          pickupAt: new Date(pickupLocal).toISOString(),
          flightNumber: text("flightNumber") || undefined,
          passengers: Number(text("passengers")),
          bags: Number(text("bags")),
          contactName: text("contactName"),
          contactPhone: text("contactPhone"),
          notes: text("notes") || undefined,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { url?: string; paid?: boolean; error?: string };
      if (!response.ok) {
        setError(result.error ?? "We couldn't start your booking. Please try again.");
        setSubmitting(false);
        return;
      }
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      toast.success("Your transfer is booked.");
      router.push("/bookings?transfer_success=1");
    } catch {
      setError("We couldn't reach FYStay. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <Label htmlFor="pickupAddress">Pickup address</Label>
        <Input id="pickupAddress" name="pickupAddress" required maxLength={300} placeholder="e.g. Manchester Airport, Terminal 2" />
      </div>
      <div>
        <Label htmlFor="dropoffAddress">Drop-off address</Label>
        <Input id="dropoffAddress" name="dropoffAddress" required maxLength={300} placeholder="e.g. 12 Promenade, Blackpool" />
      </div>
      <div>
        <Label htmlFor="pickupAt">Pickup date and time</Label>
        <Input id="pickupAt" name="pickupAt" type="datetime-local" required min={localInputValue(MIN_TRANSFER_NOTICE_HOURS)} />
        <p className="mt-1 text-xs text-stone-500">At least {MIN_TRANSFER_NOTICE_HOURS} hours from now.</p>
      </div>
      <div>
        <Label htmlFor="flightNumber">Flight number (optional)</Label>
        <Input id="flightNumber" name="flightNumber" maxLength={20} placeholder="e.g. BA1388" autoCapitalize="characters" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="passengers">Passengers</Label>
          <Input id="passengers" name="passengers" type="number" inputMode="numeric" min={1} max={8} defaultValue={1} required />
        </div>
        <div>
          <Label htmlFor="bags">Bags</Label>
          <Input id="bags" name="bags" type="number" inputMode="numeric" min={0} max={20} defaultValue={0} required />
        </div>
      </div>
      <div>
        <Label htmlFor="contactName">Name for the driver</Label>
        <Input id="contactName" name="contactName" required maxLength={100} defaultValue={defaultName} autoComplete="name" />
      </div>
      <div>
        <Label htmlFor="contactPhone">Phone number</Label>
        <Input id="contactPhone" name="contactPhone" type="tel" required maxLength={30} defaultValue={defaultPhone} autoComplete="tel" placeholder="+44 7700 900123" />
        <p className="mt-1 text-xs text-stone-500">{offering.providerName} may call you to confirm the details.</p>
      </div>
      <div>
        <Label htmlFor="notes">Anything else? (optional)</Label>
        <Textarea id="notes" name="notes" rows={3} maxLength={1000} placeholder="Child seat, a late flight, a meeting point..." />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" loading={submitting} className="justify-center">
        Pay {formatPrice(offering.priceCents)} and book
      </Button>
      <p className="text-center text-xs text-stone-500">
        You pay FYStay by card. To change or cancel a transfer, contact FYStay support.
      </p>
    </form>
  );
}
