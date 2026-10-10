# FYStay brand and destination plan

Written 10 October 2026 for the "FYStay: For Your Stay" rebrand (branch
`claude/fystay-rebrand`). FYStay already traded as "FYStay", but presented
itself as a Fylde-Coast-only marketplace. The rebrand gives the name its
meaning (**For Your Stay**) and repositions it from "the Fylde Coast and
nowhere else" to a local, North West marketplace that can grow across the UK
without losing its local character.

## Name

- Always **FYStay**: one word, capital F, Y and S. Never "FY Stay",
  "Fystay" or "FYSTAY" in running text.
- **For Your Stay** is what the name stands for. Use it as the logo's
  descriptor line and where it helps (About, share images, homepage title),
  not in every sentence.
- "Fylde Coast Stay" is the historical name and is not used publicly.

## Logo

Five directions were tried with the real brand typeface (DM Serif Display):

| Direction | Verdict |
| --- | --- |
| A. Two-tone wordmark only ("FY" terracotta, "Stay" ink) | Kept as the core. Already recognisable, legible at every size, no clichés. |
| **B. Wordmark + "FOR YOUR STAY" descriptor** | **Chosen** for the header, footer, emails and share images. It explains the name the first time someone sees it, and the descriptor works anywhere in the UK. |
| C. Roofline drawn over "FY" | Rejected: generic holiday-let imagery, and it crowds the letters at small sizes. |
| **D. "FY" monogram on a terracotta tile** | **Chosen** for the favicon, app icons and any square avatar. Readable down to 24px. |
| E. Location dot under the "S" | Rejected: ties the brand to a single place, against the expansion plan. |

Rules:

- Wordmark: DM Serif Display 400, tight tracking. "FY" in brand terracotta
  `#bc522f` (`brand-600`), "Stay" in ink `#301a13` (white on dark photos).
- Descriptor: "FOR YOUR STAY", spaced capitals, ink, beneath the wordmark
  and no wider than it.
- Monogram: cream "FY" (`#f6f3ec`) on `#bc522f`, corner radius about 22% of
  the tile. White on `#bc522f` passes WCAG AA for large text (4.6:1).
- Icons and share images use the same typeface (bundled in
  `assets/fonts`, SIL Open Font License), never a substitute sans-serif.

## Colour and type

No palette change: the terracotta and warm-ink palette on cream already
reads welcoming and distinctive, and changing it would make the familiar
site feel new for no gain. Two adjustments:

- Small brand marks (favicon, monogram) use `brand-600` rather than the
  lighter `brand-500`, which was under 3:1 on white.
- Headings stay DM Serif Display; body and UI stay Geist.

## Tagline

**Primary: "For Your Stay."** It is the name's own meaning, so it builds
recognition of the name instead of competing with it. It's welcoming (it
puts the guest first), it's true wherever FYStay operates, and it needs no
rewrite as coverage grows.

Where a longer line is useful (About page, share image), it's paired with
a coverage line that is kept accurate:
**"For Your Stay. Independent stays from local hosts, across Lancashire."**

Alternatives considered:

| Option | Why not (yet) |
| --- | --- |
| For Your Stay. From Coast to Lakes. | Implies Lake District stays. FYStay has none: the nearest real listing, Lodge on the Lake (Carnforth), is outside the National Park. Revisit when real Cumbria listings are live. |
| For Your Stay. From Coast to Countryside. | Vaguer, and close to many generic holiday-let lines. |
| Your stay, your way. | The previous line. It said nothing a visitor couldn't guess, and "your way" promises flexibility the policies don't always offer. |
| Local stays, booked simply. | Clear, but loses the meaning of the name. |
| For your stay, wherever it takes you. | Expansion-friendly but generic; no local character. |

## Voice

Warm, plain and specific. Say what is actually true (the full price before
payment, reviews only from guests who stayed, real local hosts) rather than
"best", "guaranteed" or "verified". British English. Name places precisely.

- **Guests:** "Find your stay. Independent holiday homes, apartments and
  lodges from local hosts, with the full price shown before you book."
- **Hosts:** "List your place with a marketplace that knows your area.
  Reach guests looking for a stay near you and run everything from one
  dashboard."

## Regional identity and growth

- Today's coverage is described as **Lancashire**: the Fylde Coast towns
  (Blackpool, Lytham, St Annes, Poulton-le-Fylde, Fleetwood,
  Thornton-Cleveleys) plus North Lancashire, where Lodge on the Lake
  (Carnforth) is FYStay's first listing beyond the Fylde. Lancashire is
  accurate, broader than one coastline, and a real search term.
- The Fylde Coast stays the anchor: its towns keep their own pages, guides
  and URLs.
- Never claim the Lake District, Lancaster, Morecambe or "UK-wide" until
  there are live, bookable listings there. "The edge of the Lakes" is used
  only where it describes a real listing's location.
- **Inventory check (10 Oct 2026):** Production has no published listings
  yet (Lodge on the Lake is waiting for import). Preview has demo listings
  in the six Fylde towns only. Copy naming North Lancashire assumes the
  Lodge goes live with this release.

## Page titles

- Pattern: `{search intent or place} · FYStay`, from the root template.
  Keep the place or intent first: it's what searchers scan for.
- Homepage: `FYStay | Holiday Stays in Blackpool, the Fylde Coast & Lancashire`.
- Default (pages without their own title): `FYStay: For Your Stay`.
- Destination pages: `Holiday Accommodation in {Town}, Fylde Coast · FYStay`.

## Destination-page plan

Audited 10 October 2026, before creating any pages. **No new destination
pages are created in this rebrand.** None of the new areas has real
inventory, and a page that lists nothing would be thin and misleading.

| Destination | Existing route | Action | Main intent | Prerequisites | SEO rationale |
| --- | --- | --- | --- | --- | --- |
| Fylde Coast | `/destinations` (index, titled "Explore the Fylde Coast") | **Improve**: retitle as FYStay's destinations hub, keep the Fylde Coast section, stop claiming "nowhere else", add to sitemap | "Fylde Coast holiday accommodation" | None | It already links to every town page. It was missing from the sitemap. |
| Blackpool | `/destinations/blackpool` | **Retain, improve metadata** | "Blackpool holiday accommodation / lets" | None (demo inventory on Preview, real listings at launch) | Strongest search demand in the area. URL kept. |
| Lytham St Annes | `/destinations/lytham` and `/destinations/st-annes` | **Retain both**; mention "Lytham St Annes" in their descriptions | "Lytham St Annes holiday stays" | None | The two towns have distinct guides already. A combined page would duplicate both, and merging would throw away two indexed URLs. |
| Poulton-le-Fylde, Fleetwood, Thornton-Cleveleys | `/destinations/{slug}` | **Retain, improve metadata** | Town-specific stays | None | Existing pages with distinct local guides. |
| Lancaster | none | **Create later** | "Lancaster holiday accommodation" | At least 3 live listings in the Lancaster district, plus an original local guide | No inventory today. A page now would be thin. |
| Morecambe | none | **Create later** | "Morecambe holiday accommodation" | At least 3 live listings, plus a guide | As Lancaster. |
| North Lancashire / Carnforth | none | **Do not create yet.** The listing page is the landing page | "Holiday lodge near Carnforth / South Lakeland Leisure Village" | 3+ listings for an area page | One listing doesn't make a destination. Its own page already targets these searches. |
| Lancashire | none (the homepage now speaks to it) | **Do not create a separate page now** | "Lancashire holiday cottages / lets" | Inventory in at least two Lancashire areas beyond the Fylde | The homepage and `/destinations` hub cover this intent. A separate page would duplicate them. |
| Lake District | none | **Do not create** | "Lake District holiday accommodation" | Real listings inside Cumbria / the National Park | FYStay has no Lake District stays. Claiming them would mislead guests and search engines. |

When a "create later" page becomes due, add it to `src/lib/destinations.ts`
(which feeds the page, sitemap and town badges), with original copy, a
local guide, and the listings to back it.
