// The site's top-level pages, shared between DesktopNavLinks (lg: only) and
// the mobile GuestMenu/UserMenu dropdowns (<lg: only) - one list instead of
// two copies that could quietly drift apart. It's the same four sections as
// the section pills (see siteSections.ts), plus About, so a menu never
// offers a page under a different name from the pills. Affiliate hotels
// (/hotels) sit inside Stays rather than having a link of their own.
import { SITE_SECTIONS } from "@/lib/siteSections";

export const PRIMARY_NAV_LINKS = [
  ...SITE_SECTIONS.map(({ href, label }) => ({ href, label })),
  { href: "/about", label: "About" },
];

// The desktop header bar leaves out any link a section pill already opens
// (see SectionPills), so the same destination isn't offered twice on one
// screen. The mobile menus keep the full list: they're the only navigation
// on pages that show no pills.
const SECTION_HREFS = new Set(SITE_SECTIONS.map((section) => section.href));
export const HEADER_NAV_LINKS = PRIMARY_NAV_LINKS.filter((link) => !SECTION_HREFS.has(link.href));
