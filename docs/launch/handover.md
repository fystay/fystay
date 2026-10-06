# FYStay handover: what's left before launch

Written 6 October 2026, at the end of Stage 2 and the Stage 3 launch audit.
For whoever picks this up next, person or Claude session. **Read this first,
then [master-checklist.md](master-checklist.md)**, the running list of every
remaining item.

## Where things stand

- **The product is built.** Guests can search, book, pay (Stripe Checkout),
  get confirmation, manage, cancel and review. Hosts can list, connect payouts
  (Stripe Connect), receive bookings, see earnings and manage calendars.
  Admins have `/admin`. The homepage design is **frozen**.
- **Code:** repo `mosssirisom/fystay`, branch `claude/airbnb-competitor-1fjjpk`.
  The latest commit passes all tests (1,102 unit, 110 end-to-end on a
  production build, typecheck, lint, GitHub CI).
- **Preview** (Vercel preview deployments): its own Supabase project
  (`sqkpixwvugrxllrxlexs`, demo data), the Stripe **test** sandbox ("FYStay
  sandbox"), no email. This is where everything gets tested.
- **Production** (`fystay.vercel.app`): its own Supabase project
  (`wzatjhyfwtmxdxfmurkm`, no demo data). There's **no Stripe and no email
  yet**, so payments are refused cleanly and no emails go out. It runs an
  older build (`e665a30`, deployed 6 Oct morning); newer fixes are only on
  Preview until a fresh Production build.
- **Production database:** three migrations were waiting
  (`20261005120000_add_listing_promotions`, `20261005140000_add_listing_deals`,
  `20261005180000_add_listing_promotion_stats`). Until they're applied, the live
  homepage shows no stays (Spotlight, Last Minute Deals and Explore are empty).
  The approved workflow run **#15 (commit `0d35420`) was waiting for the owner's
  approval** when this was written.

## Step 1: finish the database update and check the live site

1. **Owner:** GitHub → Actions → "Production database migration" → run #15
   → Review deployments → approve. If it was cancelled, start a new run from
   branch `claude/airbnb-competitor-1fjjpk` with the newest full commit SHA,
   `drift_check: report`. Runbook: `docs/production-database-migrations.md`.
2. **Check the live site** (the current Production build expects the new
   tables, so no redeploy is needed for this):
   - Vercel runtime logs for Production show no more
     `ListingPromotion does not exist` / `lastMinuteDiscountPercent` errors
     (they appeared every minute before);
   - homepage: Explore filters show stays; Spotlight and Last Minute Deals
     only appear if there are live placements or deals (Production has real
     data only, so empty rows simply don't render);
   - `/search`, a town search and a property page load, with prices and the
     date picker working;
   - checkout says online payment isn't available yet (correct until Stripe
     is live).
3. **Publish today's fixes to Production.** Make a **fresh Production build**
   of the newest commit (Vercel → the newest deployment → Redeploy *without*
   build cache, targeting Production). Never promote a Preview build: it
   carries Preview variables. Then repeat the checks above.

Note for Claude sessions: the cloud sandbox's network policy blocks
`*.vercel.app` and `stripe.com`. Use the Vercel connection
(`web_fetch_vercel_url`, `get_runtime_logs`) to read the live site, or ask
the owner to allow those hosts under Network access in the environment's
settings.

## Step 2: launch blockers, in order

| # | What | Who | Guide |
|---|---|---|---|
| 1 | Decide the trading entity; set `NEXT_PUBLIC_COMPANY_LEGAL_NAME`, `NEXT_PUBLIC_COMPANY_ADDRESS` (+ `NEXT_PUBLIC_COMPANY_NUMBER` if a company). UK law requires them on the site. | Owner | [environment-variables.md](environment-variables.md) |
| 2 | Solicitor review: Terms, Privacy, Cookies, cancellation wording, **host terms (none exist yet)**. Accountant: VAT on the 10% service fee. | Owner | [legal-drafts.md](legal-drafts.md) |
| 3 | Domain: add it in Vercel; then set `NEXT_PUBLIC_BASE_URL` and `NEXTAUTH_URL` to it. | Owner | [launch-runbook.md](launch-runbook.md) §2-3 |
| 4 | **Email (Resend):** verify the sending domain; set `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_SUPPORT_EMAIL`. Without it there are no booking emails **and no password resets**. | Owner enters secrets | [stripe-and-email-setup.md](stripe-and-email-setup.md) §2 |
| 5 | `TWO_FACTOR_ENCRYPTION_KEY` (`openssl rand -hex 32`, never change it). | Owner | [environment-variables.md](environment-variables.md) |
| 6 | **Stripe live:** activate the account, Connect platform profile, branding and statement descriptor; set `STRIPE_SECRET_KEY` (`sk_live_`), `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`; create the two live webhook endpoints. | Owner enters secrets | [stripe-and-email-setup.md](stripe-and-email-setup.md) §1 |
| 7 | **Roll the Stripe test key** that was pasted in chat (Stripe sandbox → API keys → roll), then update the Preview `STRIPE_SECRET_KEY`. | Owner | |
| 8 | Fresh Production build after any variable change. | Owner or Claude | runbook §0 |
| 9 | First admin account. | Owner, then Claude verifies | runbook §5 |

## Step 3: the real-world tests (owner, on Preview, before live)

These could not be run from the cloud sandbox (network blocked). Use the
newest Preview deployment.

**Stripe hand test (about 15 minutes, test cards only):**
1. Search → pick a stay → dates and guests → Reserve → Stripe page → pay
   with `4242 4242 4242 4242` (any future expiry, any CVC). Check the
   confirmation page, My trips, the host dashboard ("you earn" amount) and
   the Stripe sandbox (one payment, the right amount). Refresh the
   confirmation page: still one booking.
2. Repeat with `4000 0000 0000 0002`: the card is declined, Stripe asks for
   another card, and the booking isn't confirmed.
3. Reserve and close the tab on the Stripe page: the booking never shows as
   a trip and the dates free up within the hour (the Stripe page expires after 31 minutes).
4. On the Stripe page press Back: you're back on FYStay's checkout, it
   still says the dates are held, and paying again uses the same session (no
   second charge).
5. Cancel the booking from step 1: the dialog says how much is refunded and
   when; Stripe shows the refund.

**Phone photo test:** as a host, add a listing photo straight from a phone
camera roll (a normal 3-8MB photo). It should upload, show the right way up,
and appear on the property page and search card.

Report anything odd as a P0/P1 item in master-checklist.md.

## Step 4: after Stripe and email are live

One real booking with a real card on the live site, then cancel it. Check:
- the charge, the host's share and FYStay's fee in Stripe;
- the refund;
- the guest and host emails arrive (not in spam);
- password reset email arrives.

Then onboard a few known hosts (soft launch, runbook §7).

## Decisions waiting on the owner (don't build until decided)

- **Host cancellations:** hosts can't cancel a confirmed booking
  themselves; FYStay support does it from `/admin/bookings`. A host-side
  flow needs a refund and penalty policy first.
- **Spotlight prices** are £15 / 7 days, £25 / 14 days, £45 / 30 days
  (`src/lib/listingPromotions.ts`). Confirm or change before launch.

## Not to do now

- No homepage redesign, no new features, no P2 items. New ideas go into
  [docs/future-features.md](../future-features.md).
- Known P2 items (post-launch): two navigation landmarks share a name (minor
  accessibility); revoke public `EXECUTE` on the harmless
  `rls_auto_enable()` database function (needs a migration through the
  workflow).

## Rules any Claude session must keep

From the owner, standing:
- **Never connect Booking.com** or add it to `LIVE_HOTEL_PROVIDER_CODES`.
- Production database changes go **only** through the "Production database
  migration" workflow. No `prisma migrate dev/reset/resolve/db push` against
  Production, no manual production SQL. Never edit, rename or delete an
  existing migration.
- Never decrypt Vercel variable values. Never print, commit or invent
  secrets. Don't add secrets to CI. Don't use or store a Supabase personal
  access token.
- **The owner adds every live credential.** Stripe: test keys on Preview
  only; the app also refuses a key in the wrong environment.
- Keep production safeguards fail-closed. Demo seeding stays refused in
  Production (never set `ALLOW_PRODUCTION_SEED`).
- Develop on branch `claude/airbnb-competitor-1fjjpk`; no pull request
  unless asked.
- Plain-English, phone-friendly updates. The owner isn't a developer.
- Strategy: infrastructure and security first ([product-strategy.md](../product-strategy.md)).

## Working on the code (cloud sandbox)

- Postgres: `service postgresql start` (a container restart stops it; if pages
  500 with `PrismaClientInitializationError`, this is why).
- Dev server **must** be on port 3000 (`BASE_URL`):
  `nohup npx next dev -p 3000 > dev.log 2>&1 &`.
- Unit tests: `npx vitest run`. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`.
- End-to-end against the dev server:
  `PORT=3000 PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test <spec>`.
- Full production-style end-to-end, which is what CI runs (stop the dev server first):
  1. Create a fresh `fystay_ci` database owned by the `DATABASE_URL` user.
  2. Export `DATABASE_URL`/`DIRECT_URL` pointing at it (with `?schema=public`),
     `AUTH_SECRET=ci-test-secret-not-for-production`,
     `NEXTAUTH_URL` and `NEXT_PUBLIC_BASE_URL` as `http://localhost:3000`, and `CI=1`.
  3. `npx prisma migrate deploy && npm run db:seed && npm run build`.
  4. `E2E_PRODUCTION_SERVER=1 PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --workers=2`.
- If sign-up tests start failing with 429, clear the local rate limits:
  `DELETE FROM "RateLimitHit"` on the local database.
- End-to-end tests run two at a time and share seeded accounts. A test that
  changes a shared account (credit, bookings) should create its own user, as
  `e2e/booking-lifecycle.spec.ts` does.
- This is Next.js 16: read `node_modules/next/dist/docs/` before using an
  unfamiliar API (see `AGENTS.md`).
