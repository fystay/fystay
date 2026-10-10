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

Where a longer line is useful (share image), it's paired with a line that
makes no coverage claim, so it can't go stale in a cached preview:
**"For Your Stay. Independent holiday stays from local hosts."**

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
  guest houses from local hosts, with the full price shown before you book."
- **Hosts:** "List your place with a marketplace that knows your area.
  Reach guests looking for a stay near you and run everything from one
  dashboard."

## Regional identity and growth

Three kinds of statement, kept apart:

1. **Where guests can book (availability).** Static copy names only the
   Fylde Coast towns that have their own pages (Blackpool, Lytham, St Annes,
   Poulton-le-Fylde, Fleetwood, Thornton-Cleveleys). "In Lancashire" is
   fine as a plain location ("Find your stay in Lancashire": every
   destination FYStay has is in Lancashire). Breadth claims ("across
   Lancashire", "North Lancashire", "to the edge of the Lakes") are not
   used. Any other town appears only when it has live, bookable stays:
   `townsBeyondTheFyldeCoast()` (`src/lib/destinationInventory.ts`), read by
   the destinations hub and `llms.txt`, uses the same published / not
   suspended / payable-host rule as search.
2. **Where FYStay wants hosts (recruitment).** Host pages may invite owners
   "across Lancashire and the North West". That's an invitation, not a claim
   about stays.
3. **Ambition.** Growth across Lancashire, the North West and the UK is
   written as a plan ("plans to grow", "adds new towns as local hosts
   join"), never as current coverage.

Never say the Lake District, Lancaster or Morecambe have stays until real
listings there are live. Carnforth (Lodge on the Lake) is in Lancashire,
near but **outside** the Lake District National Park, and one property is
not Lake District coverage.

**Inventory check (10-11 Oct 2026, read-only database queries):**
Production has 0 listings and 0 host accounts, so Lodge on the Lake has not
been imported. Preview has 61 published demo listings, all in the six Fylde
towns, and no Lodge or Carnforth listing. Lodge on the Lake therefore
appears nowhere until it's imported, published and its host can take
payouts. At that point the hub lists Carnforth automatically.

## Homepage headline contrast

The hero is a looping video, from the Tower's dark ironwork to bright sky
and sand, so no text colour is readable over every frame on the general
scrim alone. Measured with the text hidden, against every pixel behind it
in the poster plus 10 frames of the matching video file per breakpoint:

| Breakpoint | Old "Lancashire" (brand-400) worst / median | Now (brand-200 + headline shade) worst / 1st pct | "Find your stay" (white) worst | Subtitle (white) worst |
| --- | --- | --- | --- | --- |
| Mobile 390px | 2.34 / 4.48* | 3.96 / 4.64 | 3.52 | 9.34 |
| Tablet 820px | 3.12 / 4.57* | 5.29 / 6.03 | 7.48 | 9.46 |
| Laptop 1024px | 2.55 / 3.84* | 4.33 / 4.74 | 4.39 | 7.47 |
| Desktop 1440px | 2.82 / 4.75* | 4.78 / 5.43 | 4.05 | 8.50 |

\* Old colour measured over the new shade. Without the shade it was
1.00-1.25 worst-case and 1.35-2.55 median.

The fix is a soft, blurred patch of the scrim's own brown
(`rgba(46,24,14,0.6)`, `blur-2xl`) behind the headline and subtitle only.
The place name is `brand-200` (`#edcfc5`), a pale terracotta. A darker
terracotta was measured and rejected: against this mid-to-dark background
brand-600 reaches only about 1.0-1.1:1 at the 5th percentile. WCAG large
text needs 3:1; every element now clears it against the worst pixel.

## Page titles

- Pattern: `{search intent or place} · FYStay`, from the root template.
  Keep the place or intent first: it's what searchers scan for.
- Homepage: `FYStay | Holiday Stays in Blackpool & the Fylde Coast, Lancashire`.
- Default (pages without their own title): `FYStay: For Your Stay`.
- Destination pages: `Holiday Accommodation in {Town}, Fylde Coast · FYStay`.

## Destination-page plan

Audited 10 October 2026, before creating any pages. **No new destination
pages are created in this rebrand.** None of the new areas has real
inventory, and a page that lists nothing would be thin and misleading.

| Destination | Existing route | Action | Main intent | Prerequisites | SEO rationale |
| --- | --- | --- | --- | --- | --- |
| Fylde Coast | `/destinations` (index, titled "Explore the Fylde Coast") | **Improved**: now "Where to stay with FYStay", with a Fylde Coast section and a "Beyond the Fylde Coast" list read from live listings (empty today). No longer claims "nowhere else". Added to sitemap | "Fylde Coast holiday accommodation" | None | It already links to every town page. It was missing from the sitemap. |
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
