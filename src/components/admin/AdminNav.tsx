import Link from "next/link";
import { cn } from "@/lib/cn";

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/listings", label: "Listings" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/promo-codes", label: "Promo codes" },
  { href: "/admin/extras", label: "Trip extras" },
  { href: "/admin/hotel-affiliate", label: "Hotel affiliate" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/review-reports", label: "Review reports" },
  { href: "/admin/support-tickets", label: "Support tickets" },
  { href: "/admin/local-data", label: "Local data" },
] as const;

/**
 * Cross-links between the admin-only pages, none of which are ever linked
 * from the site's own nav (an admin reaches them by URL, per the same
 * convention /admin/local-data already established) - without this, each
 * page was an island only reachable by typing its exact path.
 */
export function AdminNav({ active }: { active: (typeof ADMIN_LINKS)[number]["href"] }) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-border-subtle pb-4">
      {ADMIN_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "focus-ring rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            link.href === active
              ? "bg-brand-700 text-white"
              : "text-stone-600 hover:bg-surface-muted",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
