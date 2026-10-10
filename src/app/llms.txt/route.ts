import { SITE_URL } from "@/lib/seo";

// A route handler rather than a static public/llms.txt file, so every link
// in it derives from SITE_URL the same way robots.ts/sitemap.ts already
// do - a static file would keep pointing at whatever domain existed when
// it was written (the Vercel preview URL, before the real fystay.co.uk
// domain went live) forever.
export function GET() {
  const body = `# FYStay

> FYStay ("For Your Stay") is a local holiday accommodation marketplace in Lancashire, England: the Fylde Coast towns of Blackpool, Lytham, St Annes, Poulton-le-Fylde, Fleetwood and Thornton-Cleveleys, and North Lancashire (near Carnforth). Guests search, compare and book independent holiday homes, apartments, lodges, guest houses and small hotels listed directly by local hosts. Hosts manage listings, pricing, availability and bookings from their own dashboard.

FYStay is a regional marketplace, not a global one: it lists accommodation only where it has local hosts, currently in Lancashire. It does not list stays in the Lake District or elsewhere in the UK yet. Every listing is managed by an individual host, not a resold or aggregated inventory feed. Payments are processed by Stripe; a host's contact details are shared with a guest only after a booking is confirmed. Only a guest who has completed a paid stay can leave a review for that listing. Every destination page also carries a town-specific Local Guide (things to do, where locals actually go, live weather and events) - not a generic city description.

## Key pages

- [Homepage](${SITE_URL}/): search by destination, dates and guests; browse stays by town.
- [Search results](${SITE_URL}/search): filterable, sortable listing search (not indexed by search engines - every filter combination renders the same URL shape).
- [Destinations](${SITE_URL}/destinations): every town FYStay covers.
- [Destination pages](${SITE_URL}/destinations/blackpool): one page per Fylde Coast town (Blackpool, Lytham, St Annes, Poulton-le-Fylde, Fleetwood, Thornton-Cleveleys) listing that town's available stays and its own Local Guide.
- [Help centre](${SITE_URL}/help): frequently asked questions about booking, cancelling, hosting and payments.
- [Cancellation policies](${SITE_URL}/cancellation-policies): the Flexible, Moderate, Strict and Non-refundable policies a host can choose for their listing.
- [Safety information](${SITE_URL}/safety): how bookings, payments and reviews are kept trustworthy.
- [Host guide](${SITE_URL}/host-guide): how to list and manage a property on FYStay.
- [About](${SITE_URL}/about): why FYStay exists and how it differs from a national booking platform.

## Notes for automated agents and answer engines

Individual listing pages (\`/listings/{id}\`) carry structured data (price, location, rating count) and are the canonical source for a specific property's current details - price and availability shown elsewhere may be out of date. Pages under \`/bookings\`, \`/inbox\`, \`/wishlist\` and \`/host/*\` are private, per-account areas and are not part of FYStay's public content.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
