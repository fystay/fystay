# Host platform audit and upgrade (7 October 2026)

What the host side of FYStay was, what was wrong with it, how it compares with
the best products, what was fixed and built, and what to do next. Written for
the owner (plain English) and the next developer (file references).

Work is on branch `claude/host-platform-upgrade` (not live). How to release it
safely is at the end.

---

## 1. Current-state audit (before this work)

| Area | State | Verdict |
|---|---|---|
| Host dashboard | One long page: 4 stat tiles, a requests box, deposits, every listing as a row with its bookings inline. | Functional but a spreadsheet. No "today", no booking pages, numbers partly wrong. |
| Bookings | No bookings list or booking page for hosts. Bookings appeared only inside each listing row; every reference was a dead end. | Missing. |
| Earnings | "All time" and "this month" tiles only. **Finished stays dropped out of the totals.** No breakdown, no payout view. | Wrong and thin. |
| Calendar | One listing at a time; block/unblock dates; iCal import (one URL) and export. | Works, but no multi-property view, no prices, no conflict detection. |
| Listing management | One long form, no completeness guidance, **no way to publish/unpublish** (the API supported it, nothing called it). **Deleting a listing silently deleted all its bookings.** | Risky. |
| Payments (Stripe) | Checkout + Connect destination charges, webhooks with signature and amount checks, atomic cancellation refunds. | Solid core (hardened 6 Oct). |
| Deposits | Hold, claim, release all built, but **a claimed deposit never reached the host** - it stayed in FYStay's Stripe balance. | Money bug. |
| Double-booking protection | Only booking creation was serialised. Late payments, approvals and blocks could each overlap another booking. | Real risk. |
| Date changes / requests / extras | Several ways to refund twice, charge twice, or take money on a cancelled booking (details in §4). | Real risk. |
| Channel sync | iCal import daily at 06:00; Cloudbeds adapter written but unverified; SiteMinder/SuperControl stubs. | Thin. |
| Notifications | Email only; no in-app action list. | Thin. |

What was already genuinely good: server-side pricing (the browser can't set a
price), Stripe webhook verification, atomic cancellation refunds, rate-limited
and 2FA-capable login, encrypted PMS credentials, row-level security on PMS
tables, anonymise-in-place account deletion, and a large test suite.

## 2. Missing functionality (for a serious platform)

Built in this pass (see §7): a Today home, a bookings list and booking page,
an earnings page, a listings page with completeness scores, a multi-listing
calendar with conflict detection, an action centre, light gamification,
publish/unpublish, a hosting menu on desktop and phone.

Still missing, in priority order (§6 has the full roadmap):

1. **Host cancellation** (with a fair-penalty policy) - today only the guest or
   support can cancel. Needs an owner policy decision first.
2. **Real-time channel sync** via a channel manager (Channex - §5). iCal alone
   is hours behind and carries no prices or guest details.
3. **In-app notifications** (a bell with history) and **email for new
   messages / change requests / reviews** - none are emailed today.
4. **Per-date pricing** (weekend/seasonal rates, price per night on the
   calendar) - the schema only has one flat nightly price.
5. **Payout history** inside FYStay (today: live Stripe balance + a link to the
   Stripe dashboard).
6. **Listing views and search impressions** - needed for "conversion rate";
   no tracking exists, so the dashboard doesn't invent one.
7. **Saved replies / scheduled messages** (check-in instructions sent
   automatically) - the biggest time-saver for hosts in Hospitable/Guesty.

## 3. UX problems found (and what happened to each)

| Problem | Status |
|---|---|
| Dashboard was one long scroll with no "what's happening today". | **Fixed** - Today page. |
| No booking page; all booking links went to the public listing. | **Fixed** - `/host/bookings/[id]`. |
| Requests showed "Awaiting payment" when they needed the host's reply (wrong enum value). | **Fixed** - new state labels; old component removed. |
| "N upcoming bookings" counted past stays. | **Fixed**. |
| Reply-by deadline for requests was never shown. | **Fixed** - shown on Today and the booking page. |
| No publish/unpublish control. | **Fixed** - Live/Hidden switch on Listings. |
| Delete dialog promised bookings would be kept; they were deleted. | **Fixed** - deletion refused when bookings exist. |
| Guest contact details never shown to hosts (the marketing page promises them). | **Fixed** - shown on the booking page once confirmed. |
| No unread-message count anywhere for hosts. | **Fixed** - menu badge and action centre. |
| Response rate and Great Host progress computed but never shown. | **Fixed** - "Your standing" panel. |
| Calendar shows synced blocks as removable though the next sync re-adds them. | Open (low). |
| Listing form is one long page with no section navigation or preview. | Open (medium) - the completeness checklist now tells hosts what's missing. |
| Inbox threads show no booking context (dates/status). | Open (medium). |

## 4. Backend problems found (and what happened to each)

**Fixed in this pass** (all with tests):

| Severity | Problem | Fix |
|---|---|---|
| Critical | Deleting a listing cascaded to every booking, payment record and review. | `DELETE /api/listings/[id]` refuses (409) when any paid or live booking exists. |
| Critical | Captured deposit claims never reached the host. | `src/lib/depositSettlement.ts`: transfer to the host's Stripe account (idempotent, tied to the guest's charge), retried daily by the deposits cron, alert on failure. New columns `depositTransferId`, `depositTransferredAt`. |
| Critical | Double bookings possible: late payment confirmation, request approval, date-change approval and host blocks didn't serialise with each other. | `src/lib/availabilityLock.ts`: a per-listing Postgres advisory lock taken by every writer, with the availability re-check inside the same READ COMMITTED transaction. |
| Critical | Approving a shorter date change twice refunded twice. | Request claimed atomically before any refund; refunds keyed per request. |
| High | Changes could be approved/paid/applied on a cancelled booking (refunding money the policy kept, or keeping money for nothing). | Booking must still be CONFIRMED; a change payment that lands late is refunded. |
| High | Change payment created a new Stripe session per click (two payments possible); no amount check. | Open session reused; webhook refunds a wrong amount. |
| High | Change price re-charged promo codes/credit and used the listing's *current* rate. | Priced at the booking's own rate against its gross total. |
| High | Request decline (double click, or racing the expiry job) refunded credit twice. | Guarded claims. |
| High | Deposit: claim and auto-release could both act; a hold stayed on a cancelled booking's card; a new "authorise" link was emailed daily; a claim was possible before check-in. | Claim-first, release on cancel, reuse open link, cancel orphaned holds, claims only after the stay starts. |
| High | iCal-imported dates never blocked hotel room types. | Listing-wide blocks now close every room type. |
| Medium | Cancelling an unpaid booking kept the guest's credit/promo slot. | Given back, as on expiry. |
| Medium | Extras could be marked paid on a cancelled booking; no expiry on extras checkout. | 31-minute expiry; refund if booking not confirmed or amount wrong. |
| Medium | A partial refund failure silently put the booking back to CONFIRMED. | Stays cancelled, records what was refunded, alerts ops. |
| Medium | Host earnings excluded completed stays; month boundaries used server time. | `src/lib/hostInsights.ts` (UK dates, all live stays). |
| Low | A guest page's "FYStay Picks" row couldn't be scrolled by keyboard. | Focusable, labelled region. |

**Still open** (from the backend audit, not fixed here):

| Severity | Problem | Recommendation |
|---|---|---|
| High | Every notification is a silent no-op if `RESEND_API_KEY` is missing, and send errors are never checked. | Check Resend's `{ error }`; fail loudly in production config checks. |
| High | `BASE_URL` falls back to `http://localhost:3000` in production. | Refuse to start in production without it. |
| Medium | Uploaded photos keep EXIF/GPS (can reveal a property's exact location); type comes from the browser. | Re-encode on upload (sharp), check magic bytes. |
| Medium | Listing photo URLs accept any http(s) host. | Restrict to FYStay storage. |
| Medium | Review-request cron has no lower date bound (first run would email every past guest). | Add a 30-day window. |
| Medium | Missing indexes: `Booking(listingId, checkIn, checkOut)`, `Booking(status)`, `Booking(stripePaymentIntentId)`, `Message(conversationId, readAt)`. | One migration. |
| Medium | Conversation page loads every message. | Paginate. |
| Low | Forgot-password timing difference; iCal token compared non-constant-time and cached publicly. | Small hardening pass. |
| Low | Host dashboard loads a host's whole booking history (fine for hundreds, not tens of thousands). | Move totals to SQL aggregates when a host passes ~2,000 bookings. |

**Stripe:** payments, Connect (destination charges, FYStay as merchant of
record, host gets nightly rate + cleaning), refunds (reverse transfer +
application fee, proportional), disputes (ops alert, FYStay bears losses),
webhooks (signed, amount-checked, idempotent) are built and tested. Billing
(subscriptions) is deliberately not built. The live Stripe account is **not
activated yet** (owner action). Open owner decisions are in
[stripe-architecture.md](stripe-architecture.md).

## 5. Competitive comparison and channels

| | Airbnb host | Booking.com extranet | Guesty / Hostaway | Hospitable | Stripe dashboard | **FYStay now** |
|---|---|---|---|---|---|---|
| "Today" view | Excellent | Basic | Good | Excellent | n/a | **Yes** |
| Booking list + page | Good | Dense | Good | Good | n/a | **Yes** |
| Earnings with breakdown | Good (paid/upcoming) | Basic | Owner statements | Basic | Excellent | **Yes**, plus live Stripe balance |
| Multi-property calendar | Good | Rate-plan grid (heavy) | Excellent | Good | n/a | **Yes**, with conflict flags |
| Listing quality checklist | Good | Opportunity centre | No | No | n/a | **Yes**, with reasons |
| Gamification | Superhost | Genius etc. (noisy) | No | No | No | **Light**: true highlights, Great Host progress |
| Channel sync | n/a | n/a | Real-time API | Real-time API | n/a | iCal daily (+ manual sync) |
| Automated guest messages | Some | Some | Excellent | Best | n/a | **No** |
| Per-date pricing | Yes | Yes | Yes | Via tools | n/a | **No** |
| Fees to host | ~3% host fee | 15%+ commission | Subscription | Subscription | n/a | **0%** - fee is added for the guest, card fees covered |

Where FYStay can win: **simplicity** (no rate-plan grid, no programmes),
**honesty** (every figure explained, nothing invented), **0% host
commission**, and a local, curated marketplace. Where it's behind: real-time
channel sync, automated messaging, per-date pricing.

**Channels - what's possible (researched 7 Oct):**

- **Airbnb:** API by invitation only (Software Partner programme); not
  available to a new small company. iCal import/export works today (Airbnb
  refreshes about every 3 hours; dates only, no prices or guest details).
- **Booking.com:** the Connectivity Partner programme has **paused new
  providers**. iCal works for homes/holiday rentals (about every 2 hours).
  *Owner rule: never connect Booking.com - nothing here does.*
- **Expedia / Vrbo:** Connectivity Partner programme, discretionary approval.
  Vrbo supports iCal.
- **Google Vacation Rentals:** direct only for 500+ properties; otherwise via
  a connectivity provider.
- **The practical route: Channex.io** - a white-label channel-manager API
  built for platforms like FYStay. One integration gives real-time
  availability, rates, bookings (and messages/reviews) for Airbnb,
  Booking.com, Expedia, Vrbo and 60+ others. About **$130/month + $0.50 per
  holiday-rental unit**, no commission; FYStay passes Channex's
  certification, not each OTA's. It slots into the existing
  `src/lib/pms/` provider layer. Needs: a Channex account and API key
  (owner), then per-date availability/rate tables (schema) and an outbound
  push on every booking/block change.

## 6. Prioritised roadmap

**🔴 Critical - before serious host adoption**
1. ~~Money/booking integrity fixes~~ (done, §4).
2. ~~Host booking management, correct earnings~~ (done).
3. **Activate live Stripe** and run the test-card hand test on Preview (owner).
4. **Email that actually sends** (Resend domain + key) and loud failures (§4 open #1-2).
5. **Host cancellation policy** decided, then built.

**🟠 High - for a professional launch**
1. Emails for new messages, change requests and reviews; an in-app
   notification history.
2. Photo privacy: strip EXIF/GPS, re-encode uploads.
3. iCal sync every hour (not daily) and a staleness warning on each listing
   (the action centre already warns after 48 hours).
4. Missing database indexes (one migration).
5. Inbox threads with booking context.

**🟡 Medium - big improvements**
1. Channex integration (real-time Airbnb/Booking.com/Expedia/Vrbo), with
   per-date availability and rate tables.
2. Per-date and weekend pricing on the calendar.
3. Saved replies and automatic check-in messages.
4. Listing form split into steps with a preview.
5. Listing views/impressions tracking → conversion rate.

**🟢 Future**
- Smart pricing suggestions; owner statements for property managers; team
  members with roles; cleaning/task scheduling; a direct-booking mini-site
  per host; reviews of guests; a native app (the web app already works as a
  phone app via the bottom menu).

## 7. What was built in this pass

- **Hosting menu** (`src/components/host/HostNav.tsx`): Today, Bookings,
  Calendar, Earnings, Listings as tabs on desktop and a thumb-reach bottom bar
  on phones; Messages, Payouts, Channels, Spotlight one tap away; badges for
  things waiting on the host and unread messages. Pages live in the
  `src/app/host/(manage)/` route group (URLs unchanged).
- **Today** (`/host/dashboard`): greeting and one-line summary; *Needs your
  attention* (requests with reply-by, date changes, deposits to settle,
  messages, sync falling behind, grouped listing suggestions, reviews to
  answer) - most urgent first; money this month with progress towards the
  best month and a 12-month chart; today's arrivals, departures and guests in
  residence with "x of y homes occupied tonight"; the next two weeks; *Your
  standing* (true highlights + Great Host progress); the month at a glance.
- **Bookings** (`/host/bookings`, `/host/bookings/[id]`): tabs (Needs action,
  Today & staying, Upcoming, Past, Cancelled), search, listing filter, cards
  by month; booking page with stay, guest contact, Message button, earnings
  breakdown, timeline and every action (accept/decline, date change, deposit).
- **Earnings** (`/host/earnings`): all-time, booked-to-come, live Stripe
  balance; Today/week/month/last month/year/custom; change vs previous
  period; bookings, nights, average nightly rate, occupancy; where the money
  comes from; 12-month chart; by listing; the stays behind the figure.
- **Listings** (`/host/listings`): earnings, occupancy, rating, a % complete
  checklist with the reason for each item, Live/Hidden switch, actions.
- **Calendar** (`/host/calendar`): every listing on one 3-week timeline with
  stays, requests, blocks, dates booked elsewhere, prices, hotel room counts,
  and possible double bookings flagged.
- **Calculations** in tested pure functions: `hostInsights.ts`,
  `hostAttention.ts`, `hostBookingState.ts`; one data loader `hostData.ts`.
- **Demo data:** the demo host now has a believable year (made-up guest names,
  under a separate `travellers@fystay.dev` account), so Preview shows the
  dashboards working.
- **Brand:** logo tagline is now "Apartments · B&Bs · Lodges".

Gamification stays deliberately light: no points, badges for their own sake,
streak counters or animations. Every encouraging line is computed from the
host's own figures and shown only when true ("You're £320 away from your best
month", "Guests rate you 4.9★ across 12 reviews").

## 8. QA

- **Unit tests:** 1,301 passing (was 1,202), including new tests for every
  money and availability fix and every dashboard calculation.
- **End-to-end (production build):** 115 of 115 passing, covering sign-up,
  listing create/edit/delete, booking and payment (dev mode), request-to-book,
  date-change request → host approval → payment, cancellation and refund,
  deposits, reviews, messaging, accessibility (axe) and authorization.
- **Typecheck and lint:** clean.
- **Desktop (1440px) and phone (390px) screenshots** of every hosting page;
  every page measured at exactly the phone's width (no sideways scrolling).
- **Permissions:** every new page checks sign-in and host role; another
  host's booking returns "not found"; all data is scoped by `hostId`.
- **Database:** one new migration (`20261007090000_add_deposit_transfer`,
  two nullable columns + a unique index), checked against the schema
  ("no difference"), manifest updated, immutability check passing.

Not tested end to end: real Stripe payments and deposit transfers (needs the
Preview webhook set-up and a test-card run), real emails (no email provider
configured).

## Releasing this safely

The live site deploys automatically from `claude/airbnb-competitor-1fjjpk`.
This work adds two database columns, so **the database must be updated
before the code goes live** (otherwise booking pages would error):

1. GitHub → Actions → **Production database migration** → Run workflow →
   branch `claude/host-platform-upgrade`, `sha` = that branch's latest commit
   (full 40 characters), drift check `report`. Approve it.
2. When it's green, the branch is merged into `claude/airbnb-competitor-1fjjpk`
   (Claude can do this on request), which deploys it.
