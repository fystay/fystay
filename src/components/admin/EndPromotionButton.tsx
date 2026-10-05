"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";

/** Ends a live or scheduled Spotlight placement now (see /api/admin/promotions/[id]). */
export function EndPromotionButton({ id, listingTitle }: { id: string; listingTitle: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleEnd() {
    if (!window.confirm(`End the Spotlight placement for "${listingTitle}" now? Any refund is done separately in Stripe.`)) {
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/admin/promotions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Couldn't end this placement.");
      return;
    }
    toast.success("Placement ended");
    router.refresh();
  }

  return (
    <Button type="button" variant="outline" size="sm" loading={loading} onClick={handleEnd}>
      End now
    </Button>
  );
}
