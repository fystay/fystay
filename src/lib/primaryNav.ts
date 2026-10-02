// The site's top-level pages, shared between DesktopNavLinks (lg: only) and
// the mobile GuestMenu/UserMenu dropdowns (<lg: only) - one list instead of
// two copies that could quietly drift apart. "Hotels" links to /hotels -
// FYStay's own affiliate hotel search (see src/lib/hotelProviders/), a
// deliberately separate page from "Stays" (/search, FYStay's own directly-
// booked listings): the two are never the same booking flow, so the nav
// keeps them as two distinct entries rather than merging them.
import { SITE_SECTIONS } from "@/lib/siteSections";

export const PRIMARY_NAV_LINKS = [
  { href: "/search", label: "Stays" },
  { href: "/hotels", label: "Hotels" },
  { href: "/destinations", label: "Destinations" },
  { href: "/about", label: "About" },
];

// The desktop header bar leaves out any link a section pill already opens
// (see SectionPills), so the same destination isn't offered twice on one
// screen. The mobile menus keep the full list: they're the only navigation
// on pages that show no pills.
const SECTION_HREFS = new Set(SITE_SECTIONS.map((section) => section.href));
export const HEADER_NAV_LINKS = PRIMARY_NAV_LINKS.filter((link) => !SECTION_HREFS.has(link.href));
