# FYStay master launch checklist

**The single remaining-work list.** Update this file instead of re-auditing.
When an item is done, move it to COMPLETE with the commit or date.

Last full audit: 1 October 2026.

**Production now (2 October 2026):** commit `b225c38`, deployment
`dpl_AKEpMP9VuEpTJo9dzv7xZtZRSVBa`, `fystay.vercel.app`. Fresh Production
build. Post-deploy checks passed:
- pages 200;
- no `//` in robots.txt, the sitemap or canonical URLs;
- password reset returns no link;
- cron rejects a spoofed header and a wrong secret;
- Stripe unconfigured;
- `/admin/listings` live (login-gated);
- no runtime errors.

Production database migrations are current (latest
`20261001160000_normalize_stay_dates_to_utc_midnight`, applied 1 October;
none added since).

Related: [launch runbook](launch-runbook.md) ·
[environment variables](environment-variables.md) ·
[legal drafts](legal-drafts.md)

---

## FIX NOW (code)

Nothing outstanding. Every code item found in the 1 October audit is fixed
and deployed (see COMPLETE).

## CONFIGURE LATER (Vercel Production variables, no domain needed)

| Item | Why it matters | Blocks launch? |
|---|---|---|
| `TWO_FACTOR_ENCRYPTION_KEY` | 2FA shows "not available" without it. Generate once with `openssl rand -hex 32`; never change it afterwards. | Yes |
| **Sentry: live in Production since 2 Oct** (`c12c250`, `dpl_7MkzK9UhuX582sogSSNigb9MsvDw`). Project `fystay/fystay-web` (EU). DSN, org, project and auth token are set for Production + Preview. Source maps upload at build; the release is the commit SHA, with Vercel deploys recorded in Sentry. No personal data is sent. The CSP allows the ingest host. | Done | Done |
| **Manual:** delete `SEED_ADMIN_SECRET` from Vercel **Production** (keep the Preview copy) | Read only by `/api/admin/seed-demo-data`, which refuses in Production. Can't be deleted with the available tooling. | No (hygiene) |
| **Manual:** delete `PROD_DIRECT_URL` from Vercel **Production** | Only the migration workflow reads it, from the GitHub "production" environment secret, not Vercel; the app never reads it. Keep the GitHub secret. | No (hygiene) |
| `PMS_ENCRYPTION_KEY` | Only if hosts may connect a property-management system at launch. | No |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Continue with Google". Hidden until set. | No |

## REQUIRES DOMAIN

| Item | Notes |
|---|---|
| Buy/confirm the domain | Nothing in the repo proves `fystay.co.uk` is yours; the site currently shows `support@`, `privacy@` and `legal@fystay.co.uk`. |
| Point the domain at Vercel, then set `NEXT_PUBLIC_BASE_URL` (and `NEXTAUTH_URL`) to it | A trailing slash is now harmless (fixed in `65bf640`). Rebuild after changing. |
| Resend: verify the domain (SPF, DKIM, DMARC), create a sending-only API key, set `RESEND_API_KEY` + `EMAIL_FROM` | **Blocks launch**: without it there are no booking emails and no password reset. |
| Set `NEXT_PUBLIC_SUPPORT_EMAIL` / `_PRIVACY_EMAIL` / `_LEGAL_EMAIL` to mailboxes you actually read | Defaults are the `@fystay.co.uk` addresses. |
| `DISPUTE_ALERT_EMAIL`, `EV_EXEC_NOTIFICATION_EMAIL` | Ops inboxes for chargebacks and trip-extra orders. |
| Google OAuth redirect URI, Stripe webhook URLs | Must use the final domain. |

## REQUIRES BUSINESS REGISTRATION

| Item | Notes |
|---|---|
| `NEXT_PUBLIC_COMPANY_LEGAL_NAME`, `NEXT_PUBLIC_COMPANY_ADDRESS` (+ `NEXT_PUBLIC_COMPANY_NUMBER` if a company) | Shown on Terms and Privacy. A sole trader leaves the number empty (supported since `c546f0a`). **Blocks launch.** |
| ICO data-protection fee registration | Most UK businesses processing personal data must pay it. Confirm with your adviser. |
| Business bank account for Stripe payouts | Needed before live Stripe. |

## REQUIRES LIVE STRIPE (architecture decision parked)

| Item | Notes |
|---|---|
| The Stripe architecture decision | Destination charges and the 10% guest fee are unchanged; direct charges and Managed Risk remain parked. |
| Live `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | Production has no Stripe variables, so checkout correctly says payments are unavailable. |
| Live webhook endpoints (`/api/webhooks/stripe` for account and Connect events) | Register on the final domain. |
| A live end-to-end test booking and refund with a real card | Repeat the sandbox test plan in Production. |
| Hosts onboard Stripe Connect | Paid bookings are refused until the host's account can receive payouts. |

## SOLICITOR / ACCOUNTANT REVIEW

| Item | Who |
|---|---|
| Terms and Conditions, including the intermediary wording ("contract is between guest and host") | Solicitor |
| Privacy Policy (processor list updated `2d4ea9c`), Cookie Policy | Solicitor |
| Host terms: none exist yet. A draft is in [legal-drafts.md](legal-drafts.md). | Solicitor |
| Cancellation-policy wording and consumer-law refund rights | Solicitor |
| VAT treatment of the 10% guest service fee; invoicing/receipts | Accountant |
| Whether hosts must be told about tax reporting (e.g. HMRC digital-platform reporting rules) | Accountant/solicitor |
| Chargeback liability under the final Stripe structure | Solicitor, once the Stripe decision is made |

## OPTIONAL / POST-LAUNCH

- **Decision for you:** hosts can't cancel a confirmed booking themselves.
  Support (admin) does it from `/admin/bookings` and chooses the refund. Fine
  for a small launch; a host-side cancel flow needs a policy on refunds and
  penalties first.
- Host terms page: add `/legal/host-terms` and require acceptance before
  publishing, once the draft in legal-drafts.md is approved.

- Twilio phone verification (`TWILIO_*`).
- Ticketmaster events on destination pages (`TICKETMASTER_API_KEY`).
- Booking.com hotel affiliate. Credentials alone never switch it on: the code must also list it in `LIVE_HOTEL_PROVIDER_CODES`.
- PMS integrations: Cloudbeds is built, SiteMinder and SuperControl are stubs.
- Uptime monitoring on `/` and `/api/listings`; check the Supabase backup / point-in-time-recovery plan.
- A test-timezone tidy-up: one hotel-affiliate unit test fails only when the suite runs outside UTC (CI and Vercel run in UTC).

---

## Demo/test data audit (1 October 2026)

**Production database** (`wzatjhyfwtmxdxfmurkm`): clean.
- 1 user (a real GUEST account); no `@fystay.dev` demo accounts.
- 0 listings, 0 bookings, 0 reviews, 0 trip-extra providers or offerings, 0 promo codes.
- No admin yet (see runbook step 3).

**What still references demo data, and why it's safe:**
- `src/lib/demoSeed.ts` and `/api/admin/seed-demo-data` create the demo
  catalogue. The route refuses in Production unless `ALLOW_PRODUCTION_SEED=true`
  (never set it). Keep them for Preview and local development.
- Town cover photos in `public/images/listings/` are used only by demo seeding.
- The Preview database (`sqkpixwvugrxllrxlexs`) is full of demo data. That's
  intended; it never reaches Production.

**Before launch:** nothing to delete. Keep `ALLOW_PRODUCTION_SEED` unset and
remove `SEED_ADMIN_SECRET` from Production.

## Integration audit (1 October 2026)

Every integration fails safely when its credentials are missing. None returns
a secret or link, and none treats an unconfigured service as success.

| Integration | Without credentials, Production… |
|---|---|
| Stripe checkout, change payments, trip extras | refuses: "payments aren't available" |
| Stripe deposits, identity, Connect onboarding/dashboard, webhooks | refuses (501/503 or redirect with an error) |
| Resend (email) | skips notifications; password reset gives the generic reply; email change is refused |
| 2FA | shows "not available"; enroll returns 503 |
| Twilio | shows "not available" |
| Google sign-in | button hidden, provider not registered |
| Supabase storage | uploads say "not configured" (Production **is** configured: buckets `listing-photos`, `avatars`) |
| PMS (Cloudbeds/SiteMinder/SuperControl) | connect fails with a clear error; webhooks fail closed |
| Hotel affiliate | mock provider never runs in Production; Booking.com needs code activation |
| Ticketmaster | no events shown |
| Sentry | no-op |
| Cron | requires `CRON_SECRET` (set, verified) |

## SEO / mobile / accessibility / admin audit (1 October 2026)

- **SEO:** every page has metadata. Search is noindexed, as are suspended
  listings. robots.txt blocks the private areas. Sitemap and canonical URLs
  are fixed for the trailing-slash base URL (`65bf640`). Structured data on
  home, listing, destination and help pages.
- **Mobile:** no horizontal overflow on the live pages checked at 390px
  (home, search, hotels, destination, host, travel extras, help, contact,
  admin listings). The empty-catalogue states read correctly.
- **Accessibility:** axe checks run in CI on home, search, listing,
  destination, login/register, account/bookings/wishlist and host dashboard.
- **Admin:** overview, bookings, users (suspend), **listings (suspend and
  reinstate, new in `0137da1`)**, promo codes, trip extras, hotel affiliate,
  disputes, review reports, support tickets, local data. The first admin is
  created with `npm run admin:grant` (new in `c546f0a`).

---

## Database connection pooling (investigated 2 Oct, Sentry FYSTAY-WEB-1..3)

**Finding: a real scaling risk, not urgent at today's zero traffic.** Two causes combine:

1. **`connection_limit=1` on the Prisma connection.** The Preview `DATABASE_URL`
   sets it (Prisma's own default on a 2-CPU function would be 5). The homepage
   fans out several queries at once (`MarketplaceSections`, `ExploreDestinations`'
   `groupBy`, auth), and Vercel runs concurrent requests on the same instance.
   All three failures came from one instance 26s after it started, so every
   query queued behind a single connection and hit Prisma's 10s `pool_timeout`.
2. **Region mismatch.** Functions run in `iad1` (Washington DC); both Supabase
   projects are in `eu-west-1` (Ireland). Every query pays a transatlantic round
   trip (roughly 70-80ms), which lengthens that queue.

Production has had **no** pool timeouts (7 days of Vercel logs; Sentry shows
none). It has an empty catalogue and no traffic, so it hasn't been tested yet.
Production's `DATABASE_URL` is a Sensitive variable, so its `connection_limit`
can't be read. It's described as the same transaction pooler as Preview and
should be assumed identical.

**Fix (config only: no code, schema, migration or data change):**
- **A. Smallest:** in Vercel `DATABASE_URL` (Preview first, then Production),
  keep the Supabase transaction pooler (port 6543, `pgbouncer=true`) and change
  `connection_limit=1` to `connection_limit=5`, adding `pool_timeout=20`.
  Supavisor transaction mode multiplexes client connections cheaply, so that's
  roughly 40 concurrent instances before Supabase's default client cap.
  Redeploy, then check.
- **B. Recommended next:** run functions next to the database by adding
  `"regions": ["dub1"]` to `vercel.json`. This cuts query latency for every
  page, and Dublin is also closer to UK guests. It's a one-line deployment
  config change; ship it separately after A, and verify on Preview first.

**Validation plan:** apply A to Preview, redeploy, then load the homepage
cold with about 20 concurrent requests. Expect no `Timed out fetching a new
connection`. Then apply to Production.

## COMPLETE

| Item | Commit |
|---|---|
| Sentry error monitoring live in Production (browser + server + edge, source maps, releases); verified with a Preview test event | `c12c250` |
| Production deploy of the readiness batch (admin listings, base-URL fix, privacy processors, admin bootstrap, 2FA state, a11y CI fix), verified live, 2 Oct | `b225c38` (`dpl_AKEpMP9VuEpTJo9dzv7xZtZRSVBa`) |
| Password-reset guard verified live in Production (no link; guard log line present) | `4bc67b5`, kept in `b225c38` |
| Cron auth verified: real Vercel cron returned 200 with `CRON_SECRET`; spoofed header and wrong secret return 401 | `2341bf1`, kept in `b225c38` |
| Accessibility CI check made deterministic (fade-in race that failed CI on `4bc67b5`; real contrast 5.09:1, not a UI bug) | `4625d57` |
| Launch docs (this checklist, runbook, env reference, legal drafts) | `54480f9` |
| Admin listing moderation page | `0137da1` |
| Base URL trailing-slash normalisation (sitemap/canonical/email/Stripe links) | `65bf640` |
| Privacy policy names every data processor, conditional on configuration | `2d4ea9c` |
| Admin bootstrap script; 2FA "not available" state; sole-trader disclosure; configurable contact emails | `c546f0a` |
| Password-reset and email-change links never returned off local; trip extras never marked paid without Stripe (deployed) | `4bc67b5` |
| Demo cover-photo retrofit route removed | `774a7a8` |
| Stay dates stored as calendar dates; data migration run in Production | `a2401df` |
| Cron authenticated with `CRON_SECRET` (verified with a real Vercel cron run) | `2341bf1` |
| 2FA attempt rate limit | `6ce0201` |
| Host-entered email content escaped | `5d84ef5` |
| Malformed JSON gives 400 on all body-parsing routes | `6ec6503` |
| Suspended listings removed from sitemap; robots.txt blocks private areas | `e0acb77` |
| Fixed-locale dates; mobile host dashboard | `7c53cd7` |
| Late-payment, double-booking and change-extension fixes; checkout session expiry | `c921936`, `db91e28` |
| Public API no longer returns private listing fields; guests can become hosts | earlier phase-5 commits |
