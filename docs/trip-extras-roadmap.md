# Trip Extras / all-inclusive packages roadmap

See `docs/product-strategy.md` for the project-wide build sequencing
(infrastructure first, real API credentials second) that governs how this
feature's own phases below get prioritized against everything else.

## Origin

This document exists because the user asked for their original (dictated,
lightly-punctuated) request to be preserved verbatim alongside the plan, so
the reasoning behind later decisions stays traceable back to what was
actually asked for.

### The user's original request (verbatim)

> I want you to incorporate EV exec into this business. Um, not a direct
> link, but more sort of, for example, uh, customer books, a hotel, or a
> Airbnb. And then the next page is sort of like an extra, like, do you, um,
> do you need transfer from the airport? What do you think like that? And
> then obviously, I recommend, uh, my business, and you'll have a, um, sort
> of direct link to my business where they can book it. Or is it more
> preferred if it could book it via the FY stay website And and then,
> obviously, that's sort of like a separate API. I'm not really sure how it
> works. So let's let's explore that option next because going forward, I
> think where I wanna be making my money is booking a whole package. FY
> stay is not just a a Airbnb hotel platform. The the money wants... I need
> to make the money in the extras. So, for example, the, like I said, the
> transfers, the links to the pleasure beach, you know, for example, it's
> like when you're booking with Virgin, the best example, when you book
> with Virgin, you can book the hotel, you can put your flights, and then
> it says, do you wanna book your Disney tickets as well? and then do you
> wanna book your car hire as well? You know, that's the platform I want it
> to be. But if you need everything, you get it all there, and then it's
> not just a Booking dot com platform. It's kinda like an all inclusive
> holiday. You know? I want options as well where they can book via the
> website. And it's like, oh, you've got all inclusive, you know, hotel.
> And then do you wanna book your taxi as well from the airport? It's like,
> wow. You know, it's all inclusive, and this is all the price door to door
> service. That's a selling point. Door to door service. So summarize what
> I've said, and let's stop [start] building in phases each one of the
> things I want.

### Clarifying answers given

- **EV Exec's current booking setup**: it already has its own website
  booking form (not phone-only, no API today).
- **Payment model for Phase 1**: FYStay takes the guest's payment directly
  (not a simple link-out/referral) - this is what makes "extras" an actual
  revenue line rather than a referral fee, and delivers the "one price,
  door to door" feel the user described.

## The vision, summarized

FYStay stops being purely an accommodation marketplace and becomes a
**package/upsell platform** - closer to how Virgin Holidays cross-sells
airport transfers, theme-park tickets, and car hire once a flight+hotel is
booked, than to a plain Airbnb/Booking.com clone. Concretely:

1. After a guest books a stay, show a follow-up "Complete your trip" step
   offering paid add-ons, not just a bare confirmation page.
2. The first add-on is **airport transfers**, fulfilled by the user's own
   transfer business ("EV Exec") - shown as the recommended option.
3. Further add-ons planned over time: attraction tickets (Pleasure Beach
   named specifically), car hire, and likely more local experiences.
4. **FYStay takes the payment itself** for these add-ons (not a referral
   link out to the provider's own site) - the guest pays FYStay once, and
   FYStay is responsible for getting the job to the provider.
5. The business-model point, in the user's own words: *"I need to make the
   money in the extras."* Accommodation is the hook; the add-on package is
   where the margin is meant to live.

## Design decision: a generic "Trip Extras" framework, not a one-off transfer feature

Rather than hard-coding "EV Exec airport transfer" as a special case, this
is built as a small marketplace primitive from the start, since the user
has already named at least three future add-on types (transfers,
attraction tickets, car hire):

- `ExtraProvider` - a business FYStay can sell add-ons for (EV Exec first).
  Carries the provider's own booking-form/contact details so Phase 1
  fulfillment (see below) has somewhere real to send a job even before any
  provider has an API.
- `ExtraOffering` - one bookable, priced thing a provider sells through
  FYStay (e.g. "Return airport transfer"). Category-tagged
  (`AIRPORT_TRANSFER`, `ATTRACTION_TICKET`, `CAR_HIRE`, ...) so the
  "Complete your trip" page can group and grow without new plumbing per
  category.
- `BookingExtra` - the purchase itself: links one `Booking` to one
  `ExtraOffering`, snapshots the price actually paid (same principle as
  `Booking.nightlyPriceCents` snapshotting - a later price change on the
  offering must never rewrite what a guest already agreed to pay), and
  tracks its own fulfillment status independent of the parent booking's
  status.

## Fulfillment: real API integration is Phase 3, not Phase 1

EV Exec has its own booking form today, not an API. Waiting for a real
system-to-system integration before shipping anything would block the
entire feature indefinitely. Phase 1 fulfillment is: FYStay takes the
guest's payment now, and immediately sends the provider (EV Exec first) a
structured booking-request email with every detail their own form would
have asked for (name, contact, pickup/drop-off, dates, party size) -
reusing the existing Resend-based notification pattern
(`src/lib/notificationEmails.ts`) rather than inventing a new one. Since
Phase 3 the data model tracks `BookingExtra.fulfillmentStatus`
(`PENDING` -> `SENDING` -> `SENT` -> `CONFIRMED`, or `FAILED`) so
swapping in a real API later is a fulfillment-layer change only, never a
schema or checkout change.

## Payments: FYStay's own Stripe account, not Connect

Unlike a host's nightly rate (which uses Stripe Connect destination charges
so the money lands directly in the host's own account), a Trip Extra is
FYStay's own product being resold on top of a provider's service - so its
Stripe Checkout session charges straight to FYStay's platform account, no
`transfer_data`/`application_fee_amount` split. How much (if anything)
later gets paid on to a provider like EV Exec is a business arrangement
outside this codebase for now, not something the checkout needs to
automate in Phase 1.

## Phased plan

### Phase 1 - ship one real, revenue-generating add-on end to end

1. Schema: `ExtraProvider`, `ExtraOffering`, `BookingExtra` models + enums
   (`ExtraCategory`, `BookingExtraStatus`), migration.
2. Seed EV Exec as the first `ExtraProvider`, with one `ExtraOffering`
   ("Return airport transfer").
3. `src/lib/tripExtras.ts` - pure pricing/eligibility helpers + unit tests
   (mirroring the existing `pricing.ts`/`availability.ts` pattern).
4. API: list available extras for a booking, create a Stripe Checkout
   session for a chosen extra, webhook handling to mark it paid and fire
   the provider notification email.
5. UI: a "Complete your trip" card shown on the booking confirmation page
   (and/or the trip detail page) offering the transfer, with its own
   mini-checkout.
6. Provider notification email + guest confirmation email.
7. Verify end-to-end (real Playwright run through buy-stay -> buy-transfer
   -> confirm provider email content), test, commit, push.

### Phase 2 - broaden the catalogue

- Added an ADMIN-only `/admin/extras` page + CRUD API
  (`/api/admin/extras/providers`, `/api/admin/extras/offerings`) so
  onboarding the next provider is a form, not a hand-edit of
  `prisma/seed.ts` the way EV Exec had to be in Phase 1.
- Added the next two categories (attraction tickets, car hire) as new
  `ExtraProvider`/`ExtraOffering` rows - no schema changes needed, exactly
  as planned. **Naming choice:** the user's own example was Pleasure Beach
  by name, but that's a real, independent company FYStay has no confirmed
  commercial partnership with - seeding a provider row under their actual
  name (even with a placeholder email) would misrepresent an affiliation
  that doesn't exist yet. Seeded as generic placeholders instead ("Fylde
  Coast Attractions (placeholder)", "Fylde Coast Car Hire (placeholder)")
  - rename or replace via `/admin/extras` once a real partner is signed.
- Deferred to a later pass, per `docs/product-strategy.md`'s
  infrastructure-before-polish ordering: moving "Complete your trip"
  earlier into the checkout funnel (closer to the Virgin Holidays
  cross-sell moment the user pointed to) is a conversion-UX improvement,
  not infrastructure - the booking-detail-page placement already proves
  the backend end to end.

### Phase 3 - real provider integrations

- Replace email-based fulfillment with real API calls per provider as they
  become available (EV Exec's own API if/when they build one, ticketing
  APIs for attractions, car-hire aggregator APIs), behind the same
  `BookingExtra.fulfillmentStatus` contract so nothing upstream (checkout,
  pricing, UI) has to change.
- Real-time availability/pricing from providers instead of FYStay-set
  fixed prices, where a provider's API supports it.

**Built (infrastructure):**

- `BookingExtra.fulfillmentStatus` (+ reference, last error, attempt
  count, confirmed-at) and `ExtraProvider.integration`, migration
  `20260930120000_add_trip_extra_fulfillment`. The migration backfills:
  extras whose email went out become `SENT`; paid extras whose email never
  went out become `FAILED` so they show up for a retry.
- `src/lib/tripExtraFulfillment.ts`: the adapter interface, a registry
  keyed by `ExtraProvider.integration`, and `email` (Phase 1's email) as
  the first adapter. An unknown integration fails closed as `FAILED`.
  `fulfillBookingExtra` claims the row first, so the payment path hands a
  job over at most once; only an admin retry re-attempts a `FAILED` or
  stuck handoff.
- `/admin/extras` "Fulfilment" list with **Retry handoff** and **Mark
  confirmed** (with the provider's reference), via
  `POST /api/admin/extras/fulfillment/[id]`.

**Adding a real provider API** = one new adapter file registered in
`tripExtraFulfillment.ts`, its credentials behind a configuration-presence
check, and that provider's `integration` set to its code. Not built yet:
no provider has an API today. Real-time provider pricing is also still
open (it needs a provider API to exist first).

## Status

Phases 1 and 2 are done; Phase 3's fulfillment infrastructure is built
(see above), with no real provider API connected yet. This document should be updated as decisions change - it is the
source of truth for *why* this feature exists and what was actually asked
for, not just what got built.
