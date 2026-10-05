"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import { PROMOTION_PLANS, type PromotionPlanKey } from "@/lib/listingPromotions";

/**
 * Picks a Spotlight plan for one listing and starts checkout. The price
 * shown comes from the same plan list the server charges from; the server
 * never takes a price from this form.
 */
export function PromoteListingForm({
  listingId,
  listingTitle,
  extending,
}: {
  listingId: string;
  listingTitle: string;
  /** The listing is already featured, so buying adds time after its current placement. */
  extending: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<PromotionPlanKey>("WEEK");
  const [loading, setLoading] = useState(false);
  const selected = PROMOTION_PLANS.find((option) => option.key === plan)!;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const res = await fetch("/api/host/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, plan }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      setLoading(false);
      toast.error(data?.error ?? "Couldn't start the payment. Please try again.");
      return;
    }
    if (data?.url) {
      // Stays loading while the browser leaves for Stripe Checkout.
      window.location.href = data.url;
      return;
    }
    setLoading(false);
    toast.success(`${listingTitle} is in Spotlight`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <fieldset>
        <legend className="sr-only">Spotlight length for {listingTitle}</legend>
        <div className="grid grid-cols-3 gap-2">
          {PROMOTION_PLANS.map((option) => {
            const checked = option.key === plan;
            return (
              <label
                key={option.key}
                className={cn(
                  "relative flex cursor-pointer flex-col items-center rounded-xl border px-2 py-2.5 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-600/40",
                  checked
                    ? "border-brand-600 bg-brand-50 text-brand-800"
                    : "border-border-subtle bg-surface text-stone-700 hover:border-brand-200",
                )}
              >
                <input
                  type="radio"
                  name={`plan-${listingId}`}
                  value={option.key}
                  checked={checked}
                  onChange={() => setPlan(option.key)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="text-xs tabular-nums text-stone-500">{formatPrice(option.priceCents)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <Button type="submit" loading={loading} className="w-full sm:w-auto sm:self-start">
        {extending ? "Add" : "Feature for"} {selected.label} · {formatPrice(selected.priceCents)}
      </Button>
    </form>
  );
}
