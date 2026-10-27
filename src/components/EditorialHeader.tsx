import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ScrollUnderline } from "@/components/ScrollUnderline";

/**
 * The homepage's one section header: the section's name as the big,
 * underlined serif heading ("Spotlight stays"), with a "View all" style
 * link on the right where the section has a full page.
 */
export function EditorialHeader({
  id,
  name,
  link,
}: {
  /** The heading's id, for the section's aria-labelledby. */
  id: string;
  /** The section's name: the big heading. */
  name: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 sm:mb-6">
      <div className="flex items-end justify-between gap-4">
        <h2 id={id} className="text-[2rem] font-bold leading-[1.05] text-foreground sm:text-[2.6rem]">
          {/* The terracotta underline draws across as the heading scrolls
              up the screen (ScrollUnderline). */}
          <span className="relative inline-block pb-2">
            {name}
            <ScrollUnderline />
          </span>
        </h2>
        {link && (
          <Link
            href={link.href}
            className="focus-ring -my-2 flex shrink-0 items-center gap-1 rounded-sm py-2 text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            {link.label}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
