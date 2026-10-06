import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * What a homepage discovery section shows in place of its stays when it has
 * none to show (no live placements, no deals today, an empty catalogue, or
 * the stays couldn't be loaded). The section's own heading always renders,
 * so the page keeps its shape and only the stays themselves are missing.
 */
export function HomeSectionEmpty({
  message,
  link,
}: {
  message: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border-subtle bg-surface px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <p className="text-sm leading-relaxed text-stone-600">{message}</p>
      {link && (
        <Link
          href={link.href}
          className="focus-ring flex shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          {link.label}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}
