"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, Copy, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, FieldHint, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";

/**
 * Two-way calendar sync with Airbnb, Vrbo and similar, by iCal links:
 * FYStay's private export link goes into the other site, and the other
 * site's export link comes in here. Neither is real-time - each side reads
 * the other's link on its own schedule - so the card says so plainly.
 */
export function IcalSync({
  listingId,
  exportUrl,
  initialImportUrl,
  syncedAt,
  syncError,
  syncFailedAt,
}: {
  listingId: string;
  exportUrl: string;
  initialImportUrl: string | null;
  syncedAt: Date | null;
  syncError: string | null;
  syncFailedAt: Date | null;
}) {
  const router = useRouter();
  const [importUrl, setImportUrl] = useState(initialImportUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleCopyExportUrl() {
    try {
      await navigator.clipboard.writeText(exportUrl);
      toast.success("Calendar link copied");
    } catch {
      toast.error("Couldn't copy - select and copy the link manually");
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    const res = await fetch(`/api/listings/${listingId}/ical-sync`, { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSyncing(false);
    router.refresh();

    if (!res?.ok) {
      toast.error(data?.error ?? "Could not sync that calendar.");
      return;
    }
    const result = data?.result as { synced: number; removed: number } | null | undefined;
    toast.success(
      result
        ? `Synced - ${result.synced} change${result.synced === 1 ? "" : "s"} added, ${result.removed} removed`
        : "Synced",
    );
  }

  async function handleSaveImportUrl() {
    setSaving(true);
    const res = await fetch(`/api/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icalImportUrl: importUrl.trim() || null }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setSaving(false);

    if (!res?.ok) {
      toast.error(data?.error ?? "Could not save that calendar link.");
      return;
    }

    if (importUrl.trim()) {
      toast.success("Calendar link saved - syncing now");
      router.refresh();
      await handleSyncNow();
    } else {
      toast.success("Calendar import removed, with the dates it had blocked");
      router.refresh();
    }
  }

  async function handleResetExportUrl() {
    setResetting(true);
    const res = await fetch(`/api/listings/${listingId}/calendar-token`, { method: "POST" }).catch(() => null);
    setResetting(false);
    setConfirmReset(false);
    if (!res?.ok) {
      toast.error("Couldn't reset the link. Please try again.");
      return;
    }
    toast.success("New link created - add it to your other calendars");
    router.refresh();
  }

  const failedSinceLastSuccess = Boolean(syncError && syncFailedAt && (!syncedAt || syncFailedAt > syncedAt));

  return (
    <Card className="p-5">
      <CardHeader className="p-0">
        <CardTitle>Calendar sync</CardTitle>
      </CardHeader>
      <CardContent className="mt-3 flex flex-col gap-5 p-0">
        <p className="text-sm text-stone-600">
          Link this listing with Airbnb, Vrbo or another calendar so a booking on one blocks the dates on the
          other. Syncing isn&apos;t instant: FYStay checks your other calendar every morning, whenever you press
          Sync now, and again just before taking a booking if it hasn&apos;t checked in the last 30 minutes.
          Airbnb reads FYStay&apos;s link on its own schedule, usually every few hours. Until both sides
          have updated, a last-minute booking can still clash, so check new bookings on both.
        </p>

        <Field>
          <Label htmlFor="icalExportUrl">1. Your FYStay calendar link (give this to Airbnb)</Label>
          <div className="flex gap-2">
            <Input
              id="icalExportUrl"
              readOnly
              value={exportUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="text-xs text-stone-500"
            />
            <Button type="button" variant="outline" onClick={handleCopyExportUrl}>
              <Copy className="h-4 w-4" />
              Copy
            </Button>
          </div>
          <FieldHint>
            In Airbnb: Calendar → Availability → Connect calendars → Connect another calendar, then paste this
            link. It shows your FYStay bookings and blocked dates as unavailable, with no guest details. Keep it
            private - anyone with it can see which dates are taken.{" "}
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="focus-ring rounded font-medium text-brand-700 underline underline-offset-2"
            >
              Reset link
            </button>
          </FieldHint>
        </Field>

        <Field>
          <Label htmlFor="icalImportUrl">2. Your Airbnb (or other) calendar link</Label>
          <div className="flex gap-2">
            <Input
              id="icalImportUrl"
              type="url"
              inputMode="url"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              placeholder="https://www.airbnb.co.uk/calendar/ical/....ics"
            />
            <Button type="button" onClick={handleSaveImportUrl} loading={saving}>
              Save
            </Button>
          </div>
          <FieldHint>
            In Airbnb: Calendar → Availability → Connect calendars → Export calendar, and copy the link. Dates
            booked or blocked there show here as &ldquo;Booked elsewhere&rdquo;, separate from your FYStay
            bookings. Syncing never cancels or changes a FYStay booking. Clearing this link removes the dates it
            imported.
          </FieldHint>

          {initialImportUrl && failedSinceLastSuccess && (
            <div role="alert" className="mt-2 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                <span className="font-medium">
                  Last sync failed {formatDistanceToNow(syncFailedAt!, { addSuffix: true })}.
                </span>{" "}
                {syncError}{" "}
                {syncedAt
                  ? `Dates from the last good sync (${formatDistanceToNow(syncedAt, { addSuffix: true })}) are still blocked.`
                  : "No dates have been imported yet."}
              </p>
            </div>
          )}

          {initialImportUrl && (
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-stone-500">
                {syncedAt
                  ? `Last synced ${formatDistanceToNow(syncedAt, { addSuffix: true })}`
                  : "Not synced yet"}
              </span>
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={syncing}
                className="focus-ring flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-stone-700 hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-50"
              >
                <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden />
                Sync now
              </button>
            </div>
          )}
        </Field>
      </CardContent>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={handleResetExportUrl}
        title="Reset your FYStay calendar link?"
        description="The current link stops working straight away. Any calendar using it (such as Airbnb) stops seeing your FYStay bookings until you add the new link there."
        confirmLabel="Reset link"
        loading={resetting}
        danger
      />
    </Card>
  );
}
