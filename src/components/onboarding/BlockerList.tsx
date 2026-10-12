import { CheckCircle2, CircleAlert } from "lucide-react";
import type { PublicationBlocker } from "@/lib/listingReview";

/**
 * What stops a listing going live, as plain sentences, each saying whose
 * move it is - from the admin's side ("Host to do" / "FYStay to do") or the
 * host's ("You" / "FYStay").
 */
export function BlockerList({ blockers, perspective }: { blockers: PublicationBlocker[]; perspective: "admin" | "host" }) {
  if (blockers.length === 0) {
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-emerald-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
        Nothing - every check passes.
      </p>
    );
  }
  // Said to the host themselves, "waiting for the host" becomes what to do.
  const message = (blocker: PublicationBlocker) =>
    perspective === "host" && blocker.code === "awaiting_host_review"
      ? "Check the listing and approve it above (or ask for changes)."
      : blocker.message;
  const ownerLabel = (owner: PublicationBlocker["owner"]) =>
    perspective === "admin" ? (owner === "host" ? "Host to do" : "FYStay to do") : owner === "host" ? "You" : "FYStay";
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {blockers.map((blocker) => (
        <li key={blocker.code} className="flex items-start gap-2 text-sm text-stone-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            <span className="mr-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-stone-700">
              {ownerLabel(blocker.owner)}
            </span>
            {message(blocker)}
          </span>
        </li>
      ))}
    </ul>
  );
}
