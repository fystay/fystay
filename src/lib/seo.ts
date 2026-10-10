import type { Metadata } from "next";
import { BASE_URL } from "@/lib/baseUrl";

/**
 * Small shared constants/helpers for page metadata - split out so the same
 * site URL and brand name aren't re-declared (and liable to drift) across
 * layout.tsx, sitemap.ts, robots.ts and every page that builds its own
 * canonical/OG URLs. SITE_URL is the same normalised origin functional code
 * (email links, redirect URLs) takes from src/lib/baseUrl.ts.
 */

export const SITE_URL = BASE_URL;

export const SITE_NAME = "FYStay";

// Public contact addresses. Each can be set per deployment once the real
// mail domain exists; the defaults are the addresses the site has always
// shown. NEXT_PUBLIC_ so the client-side support widget sees the same value.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@fystay.co.uk";
export const PRIVACY_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL || "privacy@fystay.co.uk";
export const LEGAL_EMAIL = process.env.NEXT_PUBLIC_LEGAL_EMAIL || "legal@fystay.co.uk";

/**
 * The site-wide share image (src/app/opengraph-image.tsx). Next only adds
 * that file's image to pages that don't set their own `openGraph`, so a
 * page that does (pageMetadata below, the host page) has to name it
 * itself - without this, links to those pages unfurled with no image.
 */
export const DEFAULT_SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "FYStay - For Your Stay. Independent stays from local hosts across Lancashire.",
};

/**
 * A page's <title>/description already need to be page-specific for users
 * and organic search - but Next's metadata merging only overrides the
 * fields a route actually sets, so a route that skips `openGraph`/`twitter`
 * silently inherits the root layout's homepage-flavoured versions of both.
 * That's invisible in-browser (the tab title is still correct) but wrong
 * everywhere a link gets unfurled - Slack, iMessage, WhatsApp, an AI
 * assistant summarizing a shared link - which is exactly why a handful of
 * marketing/legal pages were quietly sharing the homepage's OG title. This
 * gives every simple content page (no listing photo, no special robots
 * rule beyond "index it") the same canonical + OG + Twitter shape in one
 * place instead of repeating it by hand per route.
 */
export function pageMetadata({
  title,
  description,
  path,
  robots,
}: {
  title: string;
  description: string;
  path: string;
  robots?: Metadata["robots"];
}): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", images: [DEFAULT_SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [DEFAULT_SHARE_IMAGE] },
    ...(robots ? { robots } : {}),
  };
}

/**
 * A listing's own title usually already names its town (hosts write things
 * like "Cosy cottage near Fleetwood Marina"), so appending the city again
 * would just repeat it. Only add "in {city}" when the title doesn't already
 * mention it, so every listing page's <title> and image alt text carry a
 * real location signal without ever duplicating one.
 */
export function withCity(title: string, city: string): string {
  return title.toLowerCase().includes(city.toLowerCase()) ? title : `${title} in ${city}`;
}
