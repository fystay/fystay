"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

/**
 * Shares the stay's own page address: the phone's share sheet where there is
 * one, otherwise a copied link. The address is the host's page - its name in
 * the link - so it reads as theirs wherever it's pasted.
 */
export function ShowcaseShareButton({ url, title, className }: { url: string; title: string; className?: string }) {
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Couldn't share this page. Copy the address from your browser instead.");
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      aria-label="Share this stay"
      className={cn(
        "focus-ring flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-stone-700 shadow-[var(--shadow-card)] backdrop-blur-sm hover:bg-white",
        className,
      )}
    >
      <Share2 className="h-4 w-4" aria-hidden />
    </button>
  );
}
