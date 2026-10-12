"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";

type Draft = { title: string; description: string; amenities: string[] };

/**
 * Admin-assisted onboarding: paste what the owner sent, get an AI first draft
 * of the title, description and amenities, check it, then save it onto the
 * private draft through the listing's normal PATCH (the same validation and
 * approval rules as typing it in). Nothing is saved until "Use this draft".
 */
export function AiDraftPanel({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  async function generate() {
    setDrafting(true);
    try {
      const res = await fetch(`/api/admin/properties/${listingId}/ai-draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't draft the listing just now. Please try again.");
        return;
      }
      setDraft(data.draft);
    } catch {
      toast.error("Couldn't reach FYStay - check your connection and try again.");
    } finally {
      setDrafting(false);
    }
  }

  async function useDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/listings/${listingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the draft. Please try again.");
        return;
      }
      toast.success("Draft saved - check every field below before sending it to the owner.");
      setDraft(null);
      setNotes("");
      router.refresh();
    } catch {
      toast.error("Couldn't reach FYStay - check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-brand-600" aria-hidden />
          Draft the words with AI
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <Label htmlFor="owner-notes">What the owner told you (their notes, advert or email)</Label>
        <Textarea
          id="owner-notes"
          rows={6}
          maxLength={8000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <p className="text-xs text-stone-500">
          The AI only uses facts in these notes. You still check every field, and the owner approves the listing before it goes live.
        </p>
        <div>
          <Button type="button" variant="outline" onClick={generate} loading={drafting} disabled={notes.trim().length < 20}>
            Draft title, description and amenities
          </Button>
        </div>
        {draft && (
          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
            <p className="font-semibold text-foreground">{draft.title}</p>
            <p className="whitespace-pre-line text-stone-700">{draft.description}</p>
            <p className="text-xs text-stone-500">
              Amenities: {draft.amenities.length > 0 ? draft.amenities.join(", ") : "none found in the notes"}
            </p>
            <div className="flex gap-2">
              <Button type="button" onClick={useDraft} loading={saving}>
                Use this draft
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                Discard
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
