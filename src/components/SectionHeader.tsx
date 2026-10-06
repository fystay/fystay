import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** One header row for every homepage discovery section: title and subtitle, with an optional "See all"-style link on the right. */
export function SectionHeader({
  title,
  subtitle,
  link,
}: {
  title: string;
  subtitle: string;
  /** `shortLabel`, when given, is what a phone shows (the full label from sm up), so a long label never crowds the title. */
  link?: { href: string; label: string; shortLabel?: string };
}) {
  return (
    <div className="mb-5 sm:mb-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-bold text-foreground sm:text-2xl">{title}</h2>
        {link && (
          <Link
            href={link.href}
            className="focus-ring -my-2.5 flex shrink-0 items-center gap-1 rounded-sm py-2.5 text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            {link.shortLabel ? (
              <>
                <span className="sm:hidden">{link.shortLabel}</span>
                <span className="hidden sm:inline">{link.label}</span>
              </>
            ) : (
              link.label
            )}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
    </div>
  );
}
