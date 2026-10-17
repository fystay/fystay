import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The homepage's one section header: a short terracotta line, a small
 * uppercase label, a serif heading and an optional supporting line - the
 * hero's "THE FYLDE COAST" treatment carried through every section - with
 * a "View all" style link on the right where the section has a full page.
 */
export function EditorialHeader({
  id,
  eyebrow,
  title,
  subtitle,
  link,
}: {
  /** The heading's id, for the section's aria-labelledby. */
  id: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 sm:mb-6">
      <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-700">
        <span aria-hidden className="h-[2px] w-6 rounded-full bg-brand-600" />
        {eyebrow}
      </p>
      <div className="mt-2 flex items-end justify-between gap-4">
        <h2 id={id} className="text-[1.6rem] font-bold leading-tight text-foreground sm:text-3xl">
          {title}
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
      {subtitle && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-stone-500">{subtitle}</p>}
    </div>
  );
}
