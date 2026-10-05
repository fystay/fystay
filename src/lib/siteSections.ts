// FYStay's four top-level sections, shown as the category pills on the
// homepage hero and above each section's own pages (see SectionPills).
// Deliberately generic so each can grow beyond what it holds today:
// Stays (FYStay listings and affiliate hotels), Discover (the towns and
// their Local Guides), Journeys (transport add-ons) and Services (the hub
// for everything else FYStay offers). The keys ("explore", "travel") are
// internal and kept stable when a label is renamed.
export type SiteSectionKey = "stays" | "explore" | "travel" | "services";

export type SiteSection = {
  key: SiteSectionKey;
  label: string;
  href: string;
  /** Routes that belong to this section: the path itself and anything under it. */
  paths: string[];
};

export const SITE_SECTIONS: SiteSection[] = [
  { key: "stays", label: "Stays", href: "/search", paths: ["/search", "/listings", "/hotels"] },
  { key: "explore", label: "Discover", href: "/destinations", paths: ["/destinations"] },
  { key: "travel", label: "Journeys", href: "/travel-extras", paths: ["/travel-extras"] },
  { key: "services", label: "Services", href: "/services", paths: ["/services"] },
];

/** The section a route belongs to, or null for pages outside all four (account, host, legal...). The homepage is Stays: its hero is the stay search. */
export function activeSiteSection(pathname: string): SiteSectionKey | null {
  if (pathname === "/") return "stays";
  const section = SITE_SECTIONS.find((candidate) =>
    candidate.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
  return section?.key ?? null;
}
