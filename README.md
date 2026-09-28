# fystay

A booking marketplace in the spirit of Airbnb: guests search and book stays, hosts list and
manage properties, and payments run through Stripe Checkout.

## Stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS
- [Prisma](https://www.prisma.io) + PostgreSQL
- [NextAuth.js](https://authjs.dev) (credentials-based auth, JWT sessions)
- [Stripe](https://stripe.com) Checkout for payments
- [react-day-picker](https://daypicker.dev) for the booking calendar
- A small in-house design system (`src/components/ui`) built on
  [class-variance-authority](https://cva.style) + [lucide-react](https://lucide.dev) icons, with
  [sonner](https://sonner.emilkowal.ski) for toasts

## Design system

`src/components/ui` holds the primitives every surface is built from: `Button`, `Input`,
`Textarea`, `Select`, `Card`, `Badge`, `Avatar`, `Skeleton`, `Spinner`, and `Dialog`/`ConfirmDialog`.
Brand colors, surface/text tokens, and shadows are defined once in `src/app/globals.css` (a teal
brand scale, chosen to read as trustworthy and premium rather than the pink-clone look); change
them there and every component picks it up. Every route has a matching `loading.tsx` skeleton,
plus shared `not-found.tsx` and `error.tsx` boundaries.

## Features

- **Listings**: browse and search by destination, dates, and guest count (a toggle-based picker
  with separate Adults, Children, Infants, and Pets counters; infants don't count toward a
  listing's capacity, and a pet count filters to listings with a "pet friendly" amenity). Detail
  pages include a photo gallery, amenities, and an availability-aware booking widget with the same
  guest picker, capped to that listing's capacity and only showing Pets if it allows them.
- **Auth & roles**: sign up as a guest or a host; hosts get a dashboard, guests get a trips page.
- **Host dashboard**: create, edit, publish/unpublish, and delete listings; see upcoming
  bookings per listing, plus a link into that listing's own availability calendar.
- **Booking & availability**: a date-range picker that disables already-booked nights.
  "Check availability" re-validates the selection against real reservation data (not just the
  calendar's client-side view) and previews the full price breakdown before anything is created;
  "Continue to payment" then holds the dates with a `PENDING` booking and moves to a dedicated
  checkout page to confirm guest contact details and review the booking before paying. If the
  dates are taken by the time of that final step (someone else booked, or the host blocked them),
  the guest sees a clear error and has to pick new ones rather than the request silently failing.
- **Host availability calendar** (`/host/listings/[id]/calendar`): a month-by-month calendar
  showing confirmed bookings, pending (unpaid) bookings, and manually blocked dates in distinct
  colors, alongside lists of each with guest/booking details and an "Unblock" action. Hosts pick a
  range of currently-available dates and close them off (maintenance, personal use, an
  off-platform booking) via a new `AvailabilityBlock` model; blocked dates are folded into the
  exact same availability check a guest booking goes through
  (`src/lib/availability.ts::blockingRanges`), so a block is exactly as unbookable as a real
  reservation everywhere availability is decided (the widget, the check-availability endpoint,
  booking creation, change requests, and search filtering). The date-range and pricing logic is
  intentionally factored into small, independent pure functions (rather than one large
  availability function) so a future rule, like a minimum/maximum stay, an advance-booking window,
  buffer days between stays, or seasonal availability, is a new predicate run alongside the
  existing ones rather than a rewrite.
- **Pricing**: nightly rate × nights, plus an optional per-listing cleaning fee and a 10% guest
  service fee (`src/lib/pricing.ts`), snapshotted onto the booking at creation time so a later
  change to the listing's rates never rewrites what a guest already agreed to pay.
- **Payments**: paying creates a Stripe Checkout session itemized by that breakdown; card details
  never touch FYStay's servers or database, since the guest enters them on Stripe's own hosted
  page. Only Stripe's server-to-server webhook ever confirms a booking (`checkout.session.completed`),
  never the browser redirect returning from it, so a guest can't fake a successful payment by
  editing the URL. A declined card is Stripe's own hosted page's problem to handle (it keeps the
  guest there to retry); a cancelled or abandoned session (`checkout.session.expired`) cancels the
  booking rather than leaving it stuck `PENDING` forever. Re-submitting (a double-click, a second
  tab, hitting back then forward) reuses the same still-open Stripe session instead of ever
  creating a second chargeable one for the same booking. A confirmation page shows the booking's
  reference, full breakdown, guest details, and payment status, and polls briefly for the webhook
  if the redirect back arrives first. Bookings move through `PENDING` → `CONFIRMED` →
  `COMPLETED` (once the stay ends) or `CANCELLED`/`REFUNDED`.
- **Host payouts (Stripe Connect)**: a host connects a Stripe Express account from `/host/payouts`
  (`src/lib/stripeConnect.ts`); once Stripe reports both `charges_enabled` and `payouts_enabled`,
  every future booking's Checkout session is a destination charge - the nightly rate + cleaning fee
  transfer straight to the host's own bank account, and FYStay's 10% service fee is retained as an
  `application_fee_amount`. A host who hasn't connected (or hasn't finished onboarding) still takes
  bookings exactly as before; the money simply settles to FYStay's own Stripe balance until they do,
  rather than blocking anything. Cancelling a booking that did pay out via Connect reverses the same
  proportion of the transfer and the platform fee (`reverse_transfer`/`refund_application_fee`) so a
  refund never leaves the host under- or over-paid relative to the guest. See [Payments without
  Stripe keys](#payments-without-stripe-keys) below for testing this without a real Stripe account.
- **Booking-lifecycle emails** (`src/lib/notificationEmails.ts`): a guest gets a confirmation when
  their booking is paid for and a notice when it's cancelled (with whatever refund actually
  applies, per the cancellation policy - never assumed to be the full amount); the host gets the
  mirror image of both, so a new booking or a cancellation is never something they only discover by
  checking the dashboard. Reuses the same Resend setup as password resets, and the same
  if-unconfigured behavior: with no `RESEND_API_KEY`, sends are silently skipped (logged nowhere,
  thrown nowhere) rather than failing the booking or cancellation that triggered them - a
  notification email must never be able to block or roll back money that already moved.
- **Photo uploads**: hosts upload real photos (via Supabase Storage) instead of pasting URLs,
  with a manual URL-paste fallback if storage isn't configured on a given deployment.
- **Reviews**: a guest can leave a star rating + comment once a booking is paid for and its stay
  has completed (`src/lib/reviews.ts`), one review per booking. Shown on the listing page (with an
  aggregate rating in the page's JSON-LD) and as a rating badge on listing cards.
- **Wishlist**: any logged-in user can save a listing with the heart button on its card or detail
  page, and view everything they've saved on `/wishlist`.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Start Postgres

```bash
docker compose up -d
```

This starts a local Postgres instance matching the connection string in `.env.example`
(`postgresql://fystay:fystay@localhost:5432/fystay`).

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in `AUTH_SECRET` with a random string (`openssl rand -base64 32`). Stripe keys can stay
blank for local development; see [Payments without Stripe keys](#payments-without-stripe-keys)
below.

### 4. Run migrations and seed data

```bash
npx prisma migrate dev
npm run db:seed
```

The seed script creates:

| Role  | Email               | Password       |
| ----- | ------------------- | -------------- |
| Host  | host@fystay.dev      | hostpass123    |
| Guest | guest@fystay.dev     | guestpass123   |

...plus three sample listings with generated placeholder art (no external image host, so the
demo never depends on network access). Photos submitted through the app itself must be real
http(s) URLs, so editing a seeded listing without replacing its placeholder photos first will fail
validation.

### 5. Run the app

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000).

## Payments without Stripe keys

If `STRIPE_SECRET_KEY` is not set, the checkout API skips Stripe entirely and confirms the
booking immediately, which is useful for exercising the full booking flow in local development
without a Stripe account. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to enable real Checkout sessions, and point a webhook at
`/api/webhooks/stripe` for the `checkout.session.completed` and `checkout.session.expired` events
(e.g. via `stripe listen --forward-to localhost:3000/api/webhooks/stripe` during development,
which forwards every event type without needing to list them individually).

To also test host payouts (Stripe Connect), enable Connect on the same Stripe account (Dashboard →
Connect → get started; test mode needs no business verification) - no separate API key is needed,
the existing `STRIPE_SECRET_KEY` covers both. Log in as a host, visit `/host/payouts`, and click
"Connect with Stripe" to run through Express onboarding with test data. To receive `account.updated`
events locally, add `--forward-to localhost:3000/api/webhooks/stripe` events for connected accounts
too: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` already forwards these; in a
deployed environment, the webhook endpoint in the Stripe Dashboard needs "Listen to events on
Connected accounts" turned on (or a second endpoint) for `account.updated` to arrive at all.

## Password resets without an email service

If `RESEND_API_KEY` is not set, `/forgot-password` skips sending an email and instead returns the
reset link directly in the response (shown inline on the page, clearly marked as dev mode), which
is useful for exercising the full reset flow in local development without an email provider. Set
`RESEND_API_KEY` (and optionally `EMAIL_FROM`, otherwise it sends from Resend's shared
`onboarding@resend.dev` sender) to send real emails via [Resend](https://resend.com).

## Deploying

`vercel.json` pins the framework to `nextjs` so Vercel builds it correctly regardless of the
project's dashboard settings. You'll need to configure, in the Vercel project's environment
variables:

- `DATABASE_URL` pointing at a real Postgres instance (e.g. [Neon](https://neon.tech) or
  [Supabase](https://supabase.com)). **On Supabase, use the pooled connection string** (the
  "Transaction pooler" option in the dashboard, port `6543`, with `?pgbouncer=true` appended).
  Serverless functions open a new connection per invocation, and a direct connection
  (port `5432`) exhausts Postgres's connection limit under real traffic.
- `DIRECT_URL` set to the *direct* (non-pooled, port `5432`) connection string. Prisma Migrate
  needs a direct connection because PgBouncer's transaction mode doesn't support the operations
  it runs, so this is used only when you run `npx prisma migrate deploy`, never by the app itself.
- `AUTH_SECRET` (a random string) and `NEXTAUTH_URL` (your deployed URL)
- `NEXT_PUBLIC_BASE_URL` set to the same deployed URL (used for Stripe redirect URLs and Open
  Graph metadata)
- Stripe keys if you want real payments; otherwise bookings auto-confirm as described above
- `RESEND_API_KEY` if you want real password-reset emails; otherwise the reset link is returned
  directly in the API response, as described above
- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` if you want real host photo uploads
  (see [Photo uploads](#photo-uploads) below); otherwise the upload button shows an error and
  hosts fall back to pasting an image URL directly
- `NEXT_PUBLIC_COMPANY_LEGAL_NAME`, `NEXT_PUBLIC_COMPANY_NUMBER` and `NEXT_PUBLIC_COMPANY_ADDRESS`
  once this is a real, trading business - see `src/lib/companyInfo.ts`. UK law requires this
  disclosure on a site taking real bookings and payments; all three are required together, or the
  Terms and Privacy pages simply omit the section rather than showing a placeholder to guests.

**Preview deployments never use the production database.** Every database and Supabase value
above (`DATABASE_URL`, `DIRECT_URL`, `PMS_HOST_SCOPED_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) is scoped to the **Production** environment only, and **Preview**
gets its own values from a separate `fystay-preview` Supabase project holding demo data only,
plus its own `AUTH_SECRET`. This is enforced, not just a convention: a non-production Vercel
deployment whose credentials identify the production project refuses to build (`next.config.ts`)
and refuses to connect (`src/lib/prisma.ts`, `src/lib/storage.ts`) - see
`src/lib/databaseIdentity.ts`. `next build` itself never connects to any database.

**Production migrations run only through the manually approved "Production database migration"
GitHub Actions workflow** (`.github/workflows/db-migrate-production.yml`), never from a build or
a laptop: run it for a commit, then promote that commit's Vercel deployment. See
[docs/production-database-migrations.md](docs/production-database-migrations.md). A new,
non-production database (a preview project, local Postgres) is created with
`npx prisma migrate deploy` against that database's own direct connection.

## Photo uploads

Hosts upload photos through `/api/uploads`, which checks the session is a logged-in host, then
uploads server-side to a Supabase Storage bucket using the `service_role` key (uploads are
authorized by our own session check, not Supabase's row-level security, since the app doesn't use
Supabase Auth). To enable this:

1. In a Supabase project, create a public bucket named `listing-photos`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` to the project's URL (not sensitive, safe to expose).
3. Set `SUPABASE_SERVICE_ROLE_KEY` to the project's `service_role` secret key from
   Settings → API Keys. **Never expose this to the client**; it's only read in
   `src/lib/storage.ts`, a server-only module.

If these aren't set, `isStorageConfigured()` returns `false` and the upload API returns a clear
error instead of crashing; the listing form's "paste an image URL" fallback still works.

## Local Guide & live local data

Every town's destination page (`/destinations/[slug]`) has a "FYStay Local Guide": curated,
written-once content (`src/lib/localGuide.ts`, `src/lib/localKnowledge.ts`) plus a live "Right now
in \<town\>" concierge panel showing current weather and a ranked spotlight of real places -
without ever calling a third-party API from the browser, or paying for one, per FYStay's own
cost/honesty rules.

**Architecture** (`src/lib/localData/`): `API/data source → server-side fetch+cache function →
Supabase (Postgres) → recommendation engine → frontend`. A React component never talks to Open-
Meteo, Overpass, or Ticketmaster directly - only to `getTownWeather`/`getTownPlaces`/
`getTownEvents`, which each read a Postgres cache, refresh it if stale, and fall back to
whatever's already cached (or an honest empty state) if the live source fails. Nothing is ever
fabricated: opening hours, ratings, and accessibility are `null` unless a real source actually says
otherwise, and `src/lib/localData/openingHours.ts` only answers open/closed for `opening_hours`
syntax it's fully confident about.

- **Weather** - [Open-Meteo](https://open-meteo.com) (free, keyless). Cached per town for 45
  minutes. The one function to call is `getTownWeather`; nothing else should import
  `weatherSource.ts` directly, so swapping providers later never touches a caller.
- **Places** - OpenStreetMap via the [Overpass API](https://overpass-api.de) (free, keyless):
  restaurants, cafés, pubs, shops, supermarkets, pharmacies, parks, beaches, playgrounds,
  attractions, museums, toilets, parking, and EV charging. Cached per town for 24 hours, since a
  restaurant doesn't move or close that often and Overpass's fair-use policy asks for infrequent,
  sequential requests.
- **Events** - [Ticketmaster Discovery API](https://developer.ticketmaster.com) (free tier, needs
  an API key). Cached for 6 hours. With no `TICKETMASTER_API_KEY` set, `/api/local/events` simply
  returns no events (logged as `SKIPPED`, not faked) rather than failing - see `.env.example`.
- **Editorial** - FYStay's own picks (`EditorialRecommendation`), migrated once from the existing
  Local Guide/Local Knowledge content via `npm run db:seed-editorial`. Nine tags are supported
  (FYStay Pick, Hidden Gem, Best for Families, Best for Couples, Best Cheap Eat, Best Breakfast,
  Best Beach, Best Walk, Best Rainy Day), though the seed script only auto-assigns the seven it can
  honestly infer from existing copy - it never guesses at a cheap-eat price or a couples angle that
  isn't already there.
- **Recommendation engine** (`recommendationEngine.ts`) merges OSM places and editorial picks into
  one ranked list, scoring on real signals only: distance from the guest's booked property (when
  known), an editorial boost, rating, weather fit (indoor picks score higher when it's raining),
  the guest's selected mood, and live open/closed status. It never simply echoes raw API data.
- **Freshness** is tracked via `ApiSyncLog` (one row per sync attempt, `SUCCESS`/`FAILURE`/
  `SKIPPED`), not "does a cached row exist" - that would keep re-fetching a town with genuinely
  zero matches forever. `hasRecentLog()` in `syncLog.ts` is the shared check every source uses.
- **Scheduled refresh**: `vercel.json` runs `/api/cron/refresh-local-data` once daily (the free
  Vercel Hobby-tier cron limit) so caches warm up on a schedule rather than on a guest's page load;
  every source still self-heals on its own TTL regardless of whether the cron has ever run. Vercel's
  own Cron feature authenticates automatically; triggering it manually needs a
  `LOCAL_DATA_CRON_SECRET` bearer token (see `.env.example`).
- **Admin dashboard** (`/admin/local-data`, requires the signed-in user's `role` to be `ADMIN` -
  see that page for how to promote one, since there's no self-service invite flow yet): per-source
  status, last successful refresh, record counts, failures in the last 7 days, sync activity in the
  last 24h, and every currently-featured editorial recommendation.

**Cost**: every source above is free at FYStay's scale. Google Places/Maps were deliberately never
introduced - the brief this was built against explicitly asks to flag any paid API before adding
one, and free/open sources cover every field the Local Guide needs today.

## Testing

- **Unit tests** ([Vitest](https://vitest.dev)) cover pure logic in `src/lib/` (availability/overlap
  math, price formatting, URL validation): `npm test` (or `npm run test:watch`).
- **End-to-end tests** ([Playwright](https://playwright.dev)) cover the golden paths: a guest
  logging in, booking a listing, and seeing it under "My trips", plus a host creating, editing,
  and deleting a listing. Run against a real running instance of the app with `npm run test:e2e`.
  This needs the dev server's database seeded first (`npx prisma migrate deploy && npm run db:seed`);
  Playwright then starts `npm run dev` itself (see `playwright.config.ts`).
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, and a production build against
  a real Postgres service on every push/PR, then runs the Playwright suite in a second job.

## Security

- **Content-Security-Policy**: `src/proxy.ts` (Next's renamed `middleware.ts`) generates a
  per-request nonce and sets a `script-src 'self' 'nonce-...' 'strict-dynamic'` CSP; every real
  page in the app is already dynamically rendered (via `auth()`), so nonces cost no static-
  generation benefit. `style-src` allows `'unsafe-inline'` since a few components (e.g. `Avatar`)
  set inline `style` attributes, which can't carry a nonce.
- Other security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Strict-Transport-Security`) are set in `next.config.ts`.
- `trustHost: true` is set in `src/auth.ts`; without it, NextAuth v5 rejects every request with
  "UntrustedHost" as soon as the app runs in production mode (`next start`/Vercel), since it
  can't otherwise tell a real request's Host header from a spoofed one. Safe here because the app
  only ever sits behind Vercel's proxy, which sets a trustworthy Host header itself.
- Stripe webhook signatures are verified (`src/app/api/webhooks/stripe/route.ts`); listing/booking
  mutation routes check resource ownership server-side, not just in the UI; booking price is
  always computed server-side from the listing's stored price, never trusted from the client.
- A `PENDING` booking (created before Stripe Checkout completes) only blocks a listing's dates for
  30 minutes (`PENDING_BOOKING_HOLD_MINUTES` in `src/lib/availability.ts`); otherwise an abandoned
  checkout would lock those dates out for every other guest indefinitely.
- Two guests booking the same dates at the exact same moment can't both succeed: booking creation
  runs its availability check and insert inside a single `SERIALIZABLE` transaction
  (`src/app/api/bookings/route.ts`), so Postgres itself rejects whichever one would conflict, and
  that guest sees a normal "those dates were just booked" error rather than a double booking.
- **Rate limiting** (`src/lib/rateLimit.ts`): login, signup, and password-reset requests are capped
  by a fixed-window counter backed by Postgres (a `RateLimitHit` row per key), not in-memory state -
  this app runs as short-lived serverless functions, so a `Map` would reset every cold start and
  wouldn't agree across concurrent instances anyway. The counter itself is a single atomic
  `INSERT ... ON CONFLICT DO UPDATE`, so concurrent requests for the same key can't race past the
  limit. Login is capped per email (10 attempts/15 min) and denies the same way a wrong password
  does - a distinguishable response would itself tell an attacker their guessing was noticed.
  Signup is capped per IP (5/hour); password-reset requests are capped both per email (3/15 min)
  and per IP (20/15 min).
- **PMS integrations get real Postgres Row Level Security** (`prisma/migrations/
  20260914070000_add_pms_row_level_security`), on top of the application-layer ownership checks
  every other route in this app relies on - the five PMS tables (`PmsConnection`,
  `PmsRoomMapping`, `PmsReservationLink`, `PmsSyncLog`, `PmsWebhookEvent`) hold another party's
  credentials and sync history, so a host session reads/writes them through a second, restricted
  database role (`fystay_pms_host_scoped`) whose RLS policies key off the calling host's id. This
  is additive and optional - the app works identically without it, relying on ownership checks
  alone, exactly as every other feature does. To turn it on against a real database:
  1. Run the migration (in production, via the production migration workflow - see
     [docs/production-database-migrations.md](docs/production-database-migrations.md)).
  2. Set a real password for the role it creates - never put this in source control:
     `ALTER ROLE fystay_pms_host_scoped WITH PASSWORD '<a-real-generated-secret>';`
  3. Set `PMS_HOST_SCOPED_DATABASE_URL` to that role's connection string (same host/port/database
     as `DATABASE_URL`, different user/password) in your production environment.

  Leave it unset and nothing breaks - see `src/lib/pms/hostScopedPrisma.ts` and the migration
  file's own header comment for exactly how the fallback works and why `FORCE ROW LEVEL SECURITY`
  is deliberately *not* used (it would also block the nightly reconciliation cron and the inbound
  webhook receiver, which legitimately need to see every host's connections).

## Project structure

```
prisma/schema.prisma       Data model (User, Listing, Booking)
prisma/seed.ts             Seed script
src/auth.ts                NextAuth configuration
src/lib/                   Prisma client, availability logic, formatting, Stripe client
src/app/                   Routes (pages + API routes)
src/components/            Shared UI (forms, booking widget, listing card, navbar)
```

## Scripts

| Command             | Description                          |
| -------------------- | ------------------------------------ |
| `npm run dev`         | Start the dev server                 |
| `npm run build`       | Production build                     |
| `npm run start`       | Start the production server          |
| `npm run lint`        | Lint                                  |
| `npm run typecheck`   | Type-check with `tsc --noEmit`       |
| `npm test`            | Run unit tests                        |
| `npm run test:watch`  | Run unit tests in watch mode          |
| `npm run test:e2e`    | Run Playwright end-to-end tests       |
| `npm run db:migrate`  | Run Prisma migrations                |
| `npm run db:manifest` | Record new migrations in `prisma/migration-manifest.json` (commit it with the migration) |
| `npm run db:check-migrations` | CI's check that no committed migration was edited, renamed or deleted |
| `npm run db:seed`     | Seed the database                    |
| `npm run db:backfill-coordinates` | One-off: backfill listing lat/lng from address |
| `npm run db:seed-editorial` | Migrate Local Guide/Local Knowledge content into `EditorialRecommendation` rows |
