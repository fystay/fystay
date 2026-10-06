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
- **New homes (moved 6 Oct evening):** GitHub repo `fystay/fystay`
  (transferred, so Actions secrets, the `production` approval environment and
  run history came with it); Supabase organisation "FYStay" (same two project
  IDs below, so database addresses are unchanged); Vercel team `fystay1`,
  project `fystay` (`prj_p09hGcqAc1k06y3c0lCFS60sQUcZ`). That Vercel project
  was **created new** on 6 Oct, not transferred: every environment variable
  has to be re-entered there by the owner (list:
  [environment-variables.md](environment-variables.md)), it has to be linked
  to `fystay/fystay`, and the `fystay.vercel.app` address stays with the old
  project until that one is deleted or the domain is moved.
- **Code:** repo `fystay/fystay`, branch `claude/airbnb-competitor-1fjjpk`.
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
  Applied on 6 Oct by run #17 (see the connection audit below).

## Connection audit after the move (6 Oct evening)

- **Code:** all checks green on `239ec44` (lint, typecheck, 1,102 unit,
  110 end-to-end on a production build, GitHub CI on `fystay/fystay`).
- **Preview database:** all 47 migrations; every one of the 550 columns the
  code expects is present, none extra.
- **Production database: up to date.** Run #17 (commit `e6e3ef5`, 6 Oct
  19:53 UTC) applied the three pending migrations; all 550 columns present,
  drift check "No drift: production matches schema.prisma". 0 listings,
  1 user, **no admin yet**. (Run #16 couldn't be approved from the GitHub
  phone app: the required reviewer was still the old `mosssirisom` account
  while the owner now signs in as `fystay`. Reviewer re-set to `fystay` the
  same evening.) Approvals come from the owner's `fystay` account; Claude's
  GitHub connection acts as `mosssirisom` and can't approve deployments.
- **Security:** every public table has row-level security with no policies
  (deny-all over Supabase's REST API; the app connects as the database
  owner), storage buckets identical in both projects. Only advisor warning:
  `rls_auto_enable()` (known P2).
- **Stripe:** both the sandbox and the live account list **no webhook
  endpoints** (rechecked 6 Oct 21:40 UTC). Without them bookings paid on
  Preview never get confirmed. Step-by-step, including Vercel's Preview
  login wall that would turn Stripe away:
  [stripe-and-email-setup.md](stripe-and-email-setup.md) §0.
- **Vercel:** new project, not readable from the cloud session that did this
  audit (connector scope). Variables, Git link and domain still to confirm.

## Security pass (6 Oct, late evening)

- **Fixed: calendar import could reach internal addresses.** A host's
  "import calendar" link was fetched with a bare `fetch()`: any address,
  any redirect, no time or size limit, and anyone can become a host. It now
  goes through `src/lib/safeFetch.ts` (public addresses only, checked at
  connection time; default ports; 3 redirects, each re-checked; 10s; 2MB),
  and the link is validated when saved.
- **Fixed: email change and account deletion needed only a signed-in
  session.** Someone holding a session (a borrowed phone, an unlocked
  laptop) could move the account to their own inbox, then reset the
  password from there. Both now ask for the current password (rate-limited;
  Google-only accounts, which have no password, can still delete).
- **Fixed: a password-reset link could be used twice** if submitted twice
  at once, and other unused reset links stayed valid after a reset. The
  link is now claimed atomically and every other open link for that account
  stops working.
- Trip-extra payments now also require Stripe's "paid" status before being
  marked paid (all checkouts are card-only, so this is belt and braces).
- Reviewed and fine: every booking, listing, message, review, support and
  admin route checks ownership or the admin role; sign-up can only create
  guests or hosts; sessions end on
  suspension, password reset and "sign out everywhere"; Stripe webhooks
  verify signatures; uploads are type- and size-checked and the storage
  buckets enforce the same.

## Step 1: finish the database update and check the live site

1. **Owner:** GitHub → Actions → "Production database migration" → run #16
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
