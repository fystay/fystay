// FYStay's four top-level sections: the phone's bottom tab bar and the
// desktop header's section control (see SectionPills). Each has one job:
// Stays (search, listings and affiliate hotels), Experiences (the towns and
// their Local Guides - things to do, attractions, days out), Services
// (airport transfers and the other services around a stay) and Saved (the
// guest's wishlist). These four are the site's one set of top-level names:
// no other menu offers the same pages under different words.
export type SiteSectionKey = "stays" | "experiences" | "services" | "saved";

export type SiteSection = {
  key: SiteSectionKey;
  label: string;
  href: string;
  /** Routes that belong to this section: the path itself and anything under it. */
  paths: string[];
};

export const SITE_SECTIONS: SiteSection[] = [
  { key: "stays", label: "Stays", href: "/search", paths: ["/search", "/listings", "/hotels"] },
  { key: "experiences", label: "Experiences", href: "/destinations", paths: ["/destinations"] },
  { key: "services", label: "Services", href: "/services", paths: ["/services", "/travel-extras"] },
  { key: "saved", label: "Saved", href: "/wishlist", paths: ["/wishlist"] },
];

/** The section a route belongs to, or null for pages outside all four (account, host, legal...). The homepage is Stays: its hero is the stay search. */
export function activeSiteSection(pathname: string): SiteSectionKey | null {
  if (pathname === "/") return "stays";
  const section = SITE_SECTIONS.find((candidate) =>
    candidate.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
  return section?.key ?? null;
}
