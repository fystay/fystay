"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

/**
 * Live / hidden switch for a listing. Hiding keeps every booking and
 * review - it only takes the listing out of search - so it's the safe
 * alternative to deleting.
 */
export function PublishToggle({ listingId, published, title }: { listingId: string; published: boolean; title: string }) {
  const router = useRouter();
  const [on, setOn] = useState(published);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setOn(next);
    setBusy(true);
    let res: Response;
    try {
      res = await fetch(`/api/listings/${listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: next }),
      });
    } catch {
      setBusy(false);
      setOn(!next);
      toast.error("Couldn't reach FYStay - check your connection and try again.");
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setOn(!next);
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? "Couldn't update the listing.");
      return;
    }
    toast.success(next ? `${title} is live` : `${title} is hidden from guests`);
    router.refresh();
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Show ${title} to guests`}
      disabled={busy}
      onClick={toggle}
      className="focus-ring group inline-flex items-center gap-2 rounded-full text-xs font-medium text-stone-600 disabled:opacity-60"
    >
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-emerald-600" : "bg-stone-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
            on ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </span>
      {on ? "Live" : "Hidden"}
    </button>
  );
}
