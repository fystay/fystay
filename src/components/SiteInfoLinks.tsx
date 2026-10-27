import Link from "next/link";
import { SITE_INFO_LINKS } from "@/lib/primaryNav";

/** Help, About and Contact under a small "FYStay" heading, for the account menus (GuestMenu, UserMenu). */
export function SiteInfoLinks({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="mt-1 border-t border-border-subtle pt-1">
      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">FYStay</p>
      {SITE_INFO_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          onClick={onNavigate}
          className="block rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-brand-50 hover:text-foreground"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
