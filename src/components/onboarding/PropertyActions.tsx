"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import type { LifecycleStage } from "@/lib/listingReview";

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { error?: string; devUrl?: string; sent?: boolean } | null;
  return { ok: Boolean(res?.ok), data };
}

/**
 * The admin's next moves on a prepared listing. Each button only appears
 * when it applies, and the server re-checks everything (publishing goes
 * through the same PATCH and publication checks as a host's own toggle).
 */
export function PropertyActions({
  listingId,
  stage,
  canSendInvitation,
  invitationSent,
  canSendForReview,
}: {
  listingId: string;
  stage: LifecycleStage;
  canSendInvitation: boolean;
  invitationSent: boolean;
  canSendForReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<{ ok: boolean; data: { error?: string; devUrl?: string; sent?: boolean } | null }>, success: string) {
    setBusy(key);
    const { ok, data } = await action();
    setBusy(null);
    if (!ok) {
      toast.error(data?.error ?? "Couldn't reach FYStay - try again.");
      return;
    }
    if (data?.devUrl) setDevUrl(data.devUrl);
    toast.success(data?.sent === false && !data.devUrl ? "Link created, but email isn't configured, so nothing was sent." : success);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {canSendInvitation && (
        <div>
          <h3 className="font-semibold text-foreground">Invitation</h3>
          <p className="mt-1 text-sm text-stone-600">
            Emails the owner a link. They sign in or register with the invited address and confirm it, then the draft becomes theirs.
            {invitationSent && " Sending again replaces the earlier link."}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            disabled={busy !== null}
            onClick={() => run("invite", () => post(`/api/admin/properties/${listingId}/invitation`, {}), "Invitation sent")}
          >
            {busy === "invite" ? "Sending…" : invitationSent ? "Send the invitation again" : "Send invitation"}
          </Button>
          {devUrl && (
            <p className="mt-2 break-all rounded-lg bg-surface-muted p-3 text-xs text-stone-700">
              Local development only (no email provider): {devUrl}
            </p>
          )}
        </div>
      )}

      {canSendForReview && (
        <div>
          <h3 className="font-semibold text-foreground">Send to the host for review</h3>
          <p className="mt-1 text-sm text-stone-600">
            The host checks everything and approves it or asks for changes. Nothing goes live until they approve.
          </p>
          <Label htmlFor="review-message" className="mt-3">
            Note for the host (optional)
          </Label>
          <Textarea
            id="review-message"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Please double-check the weekend price and the parking details."
          />
          <Button
            className="mt-3"
            disabled={busy !== null}
            onClick={() =>
              run("review", () => post(`/api/admin/properties/${listingId}/send-for-review`, { message: message || undefined }), "Sent to the host")
            }
          >
            {busy === "review" ? "Sending…" : "Send for review"}
          </Button>
        </div>
      )}

      {stage === "ready_to_publish" && (
        <div>
          <h3 className="font-semibold text-foreground">Publish</h3>
          <p className="mt-1 text-sm text-stone-600">
            The host approved this revision and every check passes. Publishing makes it visible in search and bookable.
          </p>
          <Button
            className="mt-3"
            disabled={busy !== null}
            onClick={() => run("publish", () => post(`/api/listings/${listingId}`, { published: true }, "PATCH"), "Published - it's live")}
          >
            {busy === "publish" ? "Publishing…" : "Publish now"}
          </Button>
        </div>
      )}

      {stage === "live" && (
        <div>
          <h3 className="font-semibold text-foreground">Withdraw</h3>
          <p className="mt-1 text-sm text-stone-600">
            Hides it from guests. Existing bookings stay as they are. For a serious problem, suspend it from Listings instead.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            disabled={busy !== null}
            onClick={() => run("hide", () => post(`/api/listings/${listingId}`, { published: false }, "PATCH"), "Hidden from guests")}
          >
            {busy === "hide" ? "Hiding…" : "Hide from guests"}
          </Button>
        </div>
      )}
    </div>
  );
}
