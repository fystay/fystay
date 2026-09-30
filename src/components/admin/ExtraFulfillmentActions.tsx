"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Per-row actions in /admin/extras's fulfilment list: retry a failed (or
 * stuck) provider handoff, or record the provider's own confirmation with
 * their booking reference. The server decides what's allowed - these only
 * hide buttons that would be refused anyway.
 */
export function ExtraFulfillmentActions({
  bookingExtraId,
  canRetry,
  canConfirm,
}: {
  bookingExtraId: string;
  canRetry: boolean;
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"retry" | "confirm" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reference, setReference] = useState("");

  async function send(body: { action: "retry" } | { action: "confirm"; reference?: string }) {
    setPending(body.action);
    const res = await fetch(`/api/admin/extras/fulfillment/${bookingExtraId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(null);
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      toast.error(data?.error ?? "Could not update this handoff.");
      return;
    }
    if (body.action === "confirm") {
      toast.success("Marked confirmed");
      setConfirming(false);
      setReference("");
    } else if (data?.fulfillmentStatus === "FAILED") {
      toast.error("Retried - the handoff failed again. See the reason on the row.");
    } else {
      toast.success("Handed over to the provider");
    }
    router.refresh();
  }

  if (!canRetry && !canConfirm) return null;

  if (confirming) {
    return (
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send({ action: "confirm", reference: reference.trim() || undefined });
        }}
      >
        <Input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Provider's reference (optional)"
          maxLength={200}
          aria-label="Provider's booking reference"
          className="h-8 w-56 text-sm"
        />
        <Button type="submit" size="sm" loading={pending === "confirm"}>
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </form>
    );
  }

  return (
    <div className="flex gap-2">
      {canRetry && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={pending === "retry"}
          onClick={() => void send({ action: "retry" })}
        >
          Retry handoff
        </Button>
      )}
      {canConfirm && (
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Mark confirmed
        </Button>
      )}
    </div>
  );
}
