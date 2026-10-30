import { SITE_URL } from "@/lib/seo";

/**
 * A listing's own shareable address: /stay/<its-name>-<end-of-its-id>, e.g.
 * /stay/lodge-on-the-lake-x7k2m9. The name makes it read as the host's own
 * page; the last six characters of the id make it unambiguous (two stays can
 * share a name) without a database column. /listings/<id> keeps working, and
 * stays the canonical address for search engines.
 */
const ID_SUFFIX_LENGTH = 6;

function kebab(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function listingSlug(listing: { id: string; title: string }): string {
  const name = kebab(listing.title);
  const suffix = listing.id.slice(-ID_SUFFIX_LENGTH);
  return name ? `${name}-${suffix}` : suffix;
}

/** The id's closing characters in a /stay/ slug, or null if it can't be one. */
export function idSuffixFromSlug(slug: string): string | null {
  const match = /(?:^|-)([a-z0-9]{6})$/.exec(slug.toLowerCase());
  return match ? match[1] : null;
}

export function listingStayPath(listing: { id: string; title: string }): string {
  return `/stay/${listingSlug(listing)}`;
}

export function listingStayUrl(listing: { id: string; title: string }): string {
  return `${SITE_URL}${listingStayPath(listing)}`;
}
