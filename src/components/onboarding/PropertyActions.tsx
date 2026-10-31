"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
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
  canInviteNewOwner,
  invitationSent,
  canSendForReview,
  canApprove,
}: {
  listingId: string;
  stage: LifecycleStage;
  canSendInvitation: boolean;
  /** A draft FYStay prepared with no owner attached yet: the owner's details are asked for here. */
  canInviteNewOwner: boolean;
  invitationSent: boolean;
  canSendForReview: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [owner, setOwner] = useState({ name: "", email: "", phone: "", consentNote: "" });

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
      {canInviteNewOwner && (
        <div>
          <h3 className="font-semibold text-foreground">Invite the owner</h3>
          <p className="mt-1 text-sm text-stone-600">
            This draft has no owner yet. Add their details and FYStay emails them the invitation: the listing is built, and they sign up,
            approve it, set up payouts and start taking bookings. Only send it once you have their permission.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="owner-name">Owner&apos;s name</Label>
              <Input id="owner-name" value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="owner-email">Owner&apos;s email</Label>
              <Input id="owner-email" type="email" value={owner.email} onChange={(e) => setOwner({ ...owner, email: e.target.value })} autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="owner-phone">Phone (optional)</Label>
              <Input id="owner-phone" type="tel" value={owner.phone} onChange={(e) => setOwner({ ...owner, phone: e.target.value })} autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="owner-consent">How they agreed to be contacted</Label>
              <Input
                id="owner-consent"
                value={owner.consentNote}
                onChange={(e) => setOwner({ ...owner, consentNote: e.target.value })}
                placeholder="e.g. Agreed by message, 30 Oct"
                autoComplete="off"
              />
            </div>
          </div>
          <Button
            className="mt-3"
            disabled={busy !== null}
            onClick={() =>
              run(
                "invite-new",
                () => post(`/api/admin/properties/${listingId}/invitation`, { ...owner, phone: owner.phone || undefined }),
                "Invitation sent",
              )
            }
          >
            {busy === "invite-new" ? "Sending…" : "Send invitation"}
          </Button>
          {devUrl && (
            <p className="mt-2 break-all rounded-lg bg-surface-muted p-3 text-xs text-stone-700">
              Local development only (no email provider): {devUrl}
            </p>
          )}
        </div>
      )}

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

      {canApprove && (
        <div>
          <h3 className="font-semibold text-foreground">Approve this host&apos;s listing</h3>
          <p className="mt-1 text-sm text-stone-600">
            Check the host, the photos, the description and the price look genuine. Approving publishes it straight away if every other
            check passes, and emails the host either way.
          </p>
          <Button
            className="mt-3"
            disabled={busy !== null}
            onClick={() => run("approve", () => post(`/api/admin/properties/${listingId}/approve`, {}), "Approved")}
          >
            {busy === "approve" ? "Approving…" : "Approve listing"}
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
