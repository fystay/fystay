"use client";

import { useState } from "react";
import { toast } from "sonner";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Field, FieldHint, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/SectionHeading";
import { ENGINE_LIMITS } from "@/lib/dynamicPricing";
import { commissionDecision, commissionRangeText, CURRENT_DYNAMIC_POLICY, describeCommissionPolicy, formatRate, STANDARD_COMMISSION_RATE_TEXT } from "@/lib/pricingPolicy";

export type SmartPricingValues = {
  enabled: boolean;
  autoApply: boolean;
  consentAt: string | null;
  /** Whether the host's agreement is to the current policy version. */
  consentCurrent: boolean;
  minPayoutCents: number | null;
  targetPayoutCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  maxAdjustmentPercent: number | null;
};

const toPounds = (cents: number | null) => (cents === null ? "" : String(cents / 100));
const toCents = (pounds: string) => (pounds.trim() === "" ? null : Math.round(Number(pounds) * 100));
const gbp = (cents: number) => `£${(cents / 100).toFixed(2)}`;

/**
 * The host's smart-pricing controls (src/lib/dynamicPricing.ts) and the
 * dynamic commission they agree to with it (src/lib/pricingPolicy.ts): off
 * until they turn it on and agree to the current policy version, and every
 * limit is theirs. The server checks every value again
 * (PUT /api/listings/[id]/smart-pricing).
 */
export function SmartPricingPanel({
  listingId,
  initial,
  mode,
  pricePerNightCents,
}: {
  listingId: string;
  initial: SmartPricingValues;
  /** The host's own weeknight price, for the worked example. */
  pricePerNightCents: number;
  /** "shadow": FYStay is only trialling smart pricing, so nothing changes for guests yet. */
  mode: "shadow" | "on";
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [autoApply, setAutoApply] = useState(initial.autoApply);
  const [consent, setConsent] = useState(false);
  const [minPayout, setMinPayout] = useState(toPounds(initial.minPayoutCents));
  const [targetPayout, setTargetPayout] = useState(toPounds(initial.targetPayoutCents));
  const [minPrice, setMinPrice] = useState(toPounds(initial.minPriceCents));
  const [maxPrice, setMaxPrice] = useState(toPounds(initial.maxPriceCents));
  const [maxAdjustment, setMaxAdjustment] = useState(initial.maxAdjustmentPercent === null ? "" : String(initial.maxAdjustmentPercent));
  const [saving, setSaving] = useState(false);
  // Agreement is per policy version: turning it on, or a newer version, asks again.
  const turningOn = enabled && (!initial.enabled || !initial.consentCurrent);
  const policy = CURRENT_DYNAMIC_POLICY;
  // Two weeknights at the host's own price, no other adjustments - the
  // same calculation checkout charges (commissionDecision).
  const exampleCents = pricePerNightCents * 2;
  const example = commissionDecision(policy, { accommodationCents: exampleCents });

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/listings/${listingId}/smart-pricing`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled,
          autoApply,
          consent: turningOn ? consent : undefined,
          minPayoutCents: toCents(minPayout),
          targetPayoutCents: toCents(targetPayout),
          minPriceCents: toCents(minPrice),
          maxPriceCents: toCents(maxPrice),
          maxAdjustmentPercent: maxAdjustment.trim() === "" ? null : Number(maxAdjustment),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(data.error ?? "Couldn't save smart pricing");
        return;
      }
      toast.success(enabled ? "Smart pricing saved" : "Smart pricing is off - your own prices apply");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <SectionHeading icon={TrendingUp}>Smart pricing</SectionHeading>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="text-stone-600">
          Smart pricing can move your nightly price by up to {ENGINE_LIMITS.maxAdjustmentPercent}% for particular dates, in{" "}
          {ENGINE_LIMITS.stepPercent}% steps. It only reacts to demand when FYStay&apos;s own bookings in your town are enough to be
          reliable (and to verified local events); otherwise your own price stays. It never charges guests outside the limits you
          set, and never pays you less than your minimum. It&apos;s off unless you turn it on.
        </p>
        <div className="rounded-xl border border-stone-200 p-3 text-stone-700">
          <p className="font-medium text-stone-900">FYStay&apos;s commission with smart pricing: {commissionRangeText(policy)}, worked out per booking</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {describeCommissionPolicy(policy).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2">
            Example: 2 nights at your {gbp(pricePerNightCents)}. The guest pays {gbp(exampleCents)} with nothing added. FYStay keeps{" "}
            {gbp(example.feeCents)} ({formatRate(example.rateBps)}) and you receive {gbp(exampleCents - example.feeCents)}. Card processing
            fees and FYStay&apos;s promo codes or credit come out of FYStay&apos;s share, never yours. Without smart pricing it stays a
            fixed {STANDARD_COMMISSION_RATE_TEXT}.
          </p>
        </div>
        {mode === "shadow" && (
          <p className="rounded-xl bg-stone-100 p-3 text-stone-700">
            FYStay is still trialling smart pricing: for now your own prices are charged and smart prices are only worked out alongside them.
          </p>
        )}

        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Use smart pricing for this listing
        </label>

        {initial.enabled && !initial.consentCurrent && (
          <p className="rounded-xl bg-amber-50 p-3 text-amber-950">
            FYStay&apos;s commission terms have changed since you agreed. Until you agree to the new ones below, this listing is charged
            the fixed {STANDARD_COMMISSION_RATE_TEXT} at your own price.
          </p>
        )}
        {enabled && (
          <>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
              <span>
                Change prices automatically
                <span className="block text-stone-500">Untick to keep charging your own price - FYStay will only suggest changes.</span>
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="sp-min-payout">Minimum you&apos;ll accept per night (£)</Label>
                <Input id="sp-min-payout" inputMode="decimal" value={minPayout} onChange={(e) => setMinPayout(e.target.value)} />
                <FieldHint>After FYStay&apos;s fee. Required.</FieldHint>
              </Field>
              <Field>
                <Label htmlFor="sp-target-payout">Target per night (£)</Label>
                <Input id="sp-target-payout" inputMode="decimal" value={targetPayout} onChange={(e) => setTargetPayout(e.target.value)} />
                <FieldHint>Optional. You&apos;re told when it can&apos;t be reached.</FieldHint>
              </Field>
              <Field>
                <Label htmlFor="sp-min-price">Lowest nightly price guests pay (£)</Label>
                <Input id="sp-min-price" inputMode="decimal" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />
              </Field>
              <Field>
                <Label htmlFor="sp-max-price">Highest nightly price guests pay (£)</Label>
                <Input id="sp-max-price" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
              </Field>
              <Field>
                <Label htmlFor="sp-max-adjust">Largest change (%)</Label>
                <Input id="sp-max-adjust" inputMode="numeric" value={maxAdjustment} onChange={(e) => setMaxAdjustment(e.target.value)} />
                <FieldHint>Up to {ENGINE_LIMITS.maxAdjustmentPercent}%.</FieldHint>
              </Field>
            </div>
            {turningOn && (
              <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-amber-950">
                <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>
                  I agree that FYStay may set this listing&apos;s nightly price for particular dates within the limits above
                  {autoApply ? "" : " (only as suggestions while automatic changes are off)"}, and that FYStay&apos;s commission on its
                  bookings is worked out as described above ({commissionRangeText(policy)}, policy {policy.version}). I can turn this off at
                  any time. Bookings already made keep their price and commission.
                </span>
              </label>
            )}
          </>
        )}

        <Button type="button" loading={saving} onClick={save} className="self-start" disabled={turningOn && !consent}>
          Save smart pricing
        </Button>
      </CardContent>
    </Card>
  );
}
