import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The homepage's one section header: the section's name as the big,
 * underlined serif heading ("Spotlight stays"), its line of character
 * smaller beneath it in terracotta ("Stays worth the trip"), then an
 * optional supporting line - with a "View all" style link on the right
 * where the section has a full page.
 */
export function EditorialHeader({
  id,
  name,
  tagline,
  subtitle,
  link,
}: {
  /** The heading's id, for the section's aria-labelledby. */
  id: string;
  /** The section's name: the big heading. */
  name: string;
  /** Its line of character, beneath. */
  tagline: string;
  subtitle?: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 sm:mb-6">
      <div className="flex items-end justify-between gap-4">
        <h2 id={id} className="text-[2rem] font-bold leading-[1.05] text-foreground sm:text-[2.6rem]">
          {/* The terracotta underline draws across as the heading scrolls
              into view (.heading-underline in globals.css). */}
          <span className="relative inline-block pb-2">
            {name}
            <span aria-hidden className="heading-underline absolute bottom-0 left-0 h-[3px] w-full rounded-full bg-brand-500" />
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
      <p className="mt-2 font-serif text-lg leading-snug text-brand-700 sm:text-xl">{tagline}</p>
      {subtitle && <p className="mt-1 max-w-xl text-sm leading-relaxed text-stone-500">{subtitle}</p>}
    </div>
  );
}
