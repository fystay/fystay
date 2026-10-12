"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { FieldError, Label } from "@/components/ui/Label";

/**
 * The host's explicit decision. Approving needs a deliberate tick and names
 * the revision on screen, so if FYStay changes anything while the host is
 * looking, the server refuses the approval instead of applying it to a
 * version they haven't seen.
 */
export function ReviewDecision({ listingId, revision }: { listingId: string; revision: number }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"approve" | "changes">("approve");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: unknown, success: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/host/listings/${listingId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res?.ok) {
      setError(data?.error ?? "Couldn't reach FYStay - try again.");
      return;
    }
    toast.success(success);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Your decision" className="flex gap-2">
        {(
          [
            ["approve", "Approve"],
            ["changes", "Ask for changes"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={
              mode === value
                ? "focus-ring rounded-full bg-brand-700 px-4 py-2 text-sm font-medium text-white"
                : "focus-ring rounded-full border border-border-subtle px-4 py-2 text-sm font-medium text-stone-700"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "approve" ? (
        <div>
          <label className="flex items-start gap-3 text-sm text-stone-800">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              I&apos;ve checked the photos, description, location, amenities, prices and fees, house rules, cancellation policy and
              availability, and they&apos;re accurate. I approve this version (revision {revision}).
            </span>
          </label>
          <Button
            className="mt-4"
            disabled={!confirmed || busy}
            onClick={() => submit({ action: "approve", revision, confirmed: true }, "Approved - thank you")}
          >
            {busy ? "Saving…" : "Approve this version"}
          </Button>
        </div>
      ) : (
        <div>
          <Label htmlFor="changes-note">What should change?</Label>
          <Textarea
            id="changes-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. The weekend price is £275, not £255, and the hot tub was removed last year."
          />
          <Button
            className="mt-3"
            disabled={note.trim().length < 5 || busy}
            onClick={() => submit({ action: "request_changes", note }, "Sent to FYStay")}
          >
            {busy ? "Sending…" : "Send to FYStay"}
          </Button>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </div>
  );
}
