"use client";

import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatPrice } from "@/lib/format";
import { useReserveBottomSpace } from "@/hooks/useReserveBottomSpace";
import { StripeBadge } from "@/components/StripeBadge";

export function CheckoutForm({
  bookingId,
  defaultName,
  defaultEmail,
  defaultPhone,
  guests,
  totalPriceCents,
}: {
  bookingId: string;
  defaultName: string;
  defaultEmail: string;
  defaultPhone: string;
  guests: number;
  totalPriceCents: number;
}) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const mobileBarRef = useRef<HTMLDivElement>(null);
  useReserveBottomSpace(mobileBarRef);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !phone.trim()) {
      setError("Please fill in your name, email, and phone number.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          guestName: name.trim(),
          guestEmail: email.trim(),
          guestPhone: phone.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Could not start checkout.");
        toast.error(data.error ?? "Could not start checkout.");
        setLoading(false);
        return;
      }

      // The overlay below covers the gap between this and the browser
      // actually leaving for Stripe - without it, the last thing a guest
      // sees is a spinner frozen on a button, which reads as stuck rather
      // than as "taking you somewhere on purpose".
      setRedirecting(true);
      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
      toast.error("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card>
        {/* Same signature strip as the listing page's BookingWidget - one
            visual cue for "this card is part of the money-changing-hands
            flow" that now appears consistently everywhere that flow touches. */}
        <div className="h-1.5 w-full rounded-t-2xl bg-gradient-to-r from-brand-600 via-brand-400 to-accent-400" aria-hidden />
        <CardHeader>
          <CardTitle>Confirm your details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <Label htmlFor="guestName">Full name</Label>
            <Input
              id="guestName"
              autoComplete="name"
              required
              invalid={Boolean(error)}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <Label htmlFor="guestEmail">Email</Label>
            <Input
              id="guestEmail"
              type="email"
              autoComplete="email"
              required
              invalid={Boolean(error)}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <Label htmlFor="guestPhone">Phone number</Label>
            <Input
              id="guestPhone"
              type="tel"
              autoComplete="tel"
              required
              invalid={Boolean(error)}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="For your host to reach you about the stay"
            />
            <FieldError>{error}</FieldError>
          </Field>
          <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-sm">
            <span className="text-stone-600">Guests</span>
            <span className="font-medium text-foreground">
              {guests} guest{guests === 1 ? "" : "s"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Button type="submit" loading={loading} size="lg" className="mt-6 hidden w-full lg:flex">
        Pay securely {formatPrice(totalPriceCents)}
      </Button>
      <p className="mt-3 hidden items-center justify-center gap-1.5 text-center text-xs text-stone-500 lg:flex">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        You&apos;ll pay on Stripe&apos;s secure checkout page. FYStay never sees or stores your
        card details.
      </p>
      <div className="mt-4 flex justify-center">
        <StripeBadge />
      </div>
      <p className="mt-4 text-center text-xs text-stone-500">
        By paying, you agree to FYStay&apos;s{" "}
        <Link href="/legal/terms" className="underline hover:text-stone-700">
          Terms
        </Link>{" "}
        and this stay&apos;s cancellation policy shown here. Questions before you book?{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-stone-700">
          {SUPPORT_EMAIL}
        </a>
      </p>

      <div
        ref={mobileBarRef}
        className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-4 border-t border-border-subtle bg-surface px-4 py-3 [padding-bottom:calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden"
      >
        <div>
          <p className="text-xs text-stone-500">Total</p>
          <p className="text-base font-semibold text-foreground">{formatPrice(totalPriceCents)}</p>
        </div>
        <Button type="submit" loading={loading} size="lg" className="flex-1">
          Pay securely
        </Button>
      </div>

      {redirecting && (
        <div className="animate-confirm-message-in fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-surface/95 backdrop-blur-sm">
          <Loader2 className="h-8 w-8 animate-spin text-brand-700" aria-hidden />
          <p className="text-sm font-medium text-foreground">Taking you to secure payment…</p>
        </div>
      )}
    </form>
  );
}
