# FYStay master launch checklist

**The single remaining-work list.** Update this file instead of re-auditing.
When an item is done, move it to COMPLETE with the commit or date.

Last verified: **12 October 2026** (launch-control mini-audit, read-only
checks of GitHub, Vercel, Stripe and Supabase). Earlier audits are kept
below as history. [handover.md](handover.md) has the background.

Related: [handover](handover.md) · [Stripe and email setup](stripe-and-email-setup.md) ·
[launch runbook](launch-runbook.md) ·
[environment variables](environment-variables.md) ·
[legal drafts](legal-drafts.md)

---

## Verified state (12 Oct 2026)

| Area | State | Evidence |
|---|---|---|
| Code | Working branch `claude/airbnb-competitor-1fjjpk` at `db4eda4`; CI green | GitHub Actions CI run #226 |
| Production deploy | `db4eda4` live on `www.fystay.co.uk` (apex redirects to www); `fystay.vercel.app` still attached | Vercel deployment `dpl_CEPwm2QeZUuzeNniSWJQrRHfE4YM`, domains verified |
| Production health | `/api/health`: database ok, config ok | Fetched 12 Oct |
| Production settings | Database, Auth, base URL and `NEXTAUTH_URL` (www domain), cron, 2FA key, Supabase, Sentry, Google sign-in, Resend key, `EMAIL_FROM` on own domain, dispute inbox, live Stripe key, both live webhook secrets: all present | Vercel variable names (values never read); health check confirms the Stripe key is live |
| Stripe live account | Charges and payouts enabled, identity verified, bank account linked, statement descriptor `FYSTAY`; account type: individual | Stripe API, read-only |
| Live webhooks | Account-events and connected-accounts endpoints enabled on `https://www.fystay.co.uk/api/webhooks/stripe` | Stripe API, read-only; no live event delivered yet |
| Production database | All migrations applied (run #23, 11 Oct); deny-all row-level security on every table; only advisor warning is the known P2 `rls_auto_enable()` | GitHub Actions, Supabase advisors |
| Catalogue | 0 listings live | `/api/listings` |

## LAUNCH BLOCKERS (outstanding)

| # | Blocker | Type | Next step |
|---|---|---|---|
| 1 | **Trader identity.** The business structure is not finalised, so the site can't name the trader. Set `NEXT_PUBLIC_COMPANY_LEGAL_NAME` and `NEXT_PUBLIC_COMPANY_ADDRESS` (+ `NEXT_PUBLIC_COMPANY_NUMBER` only for a company) once decided. **Never publish placeholder details.** | External (owner) | Decide the entity and the address to publish |
| 2 | **Legal sign-off.** Solicitor review of Terms, Privacy, Cookies and cancellation wording; host terms don't exist yet (draft in [legal-drafts.md](legal-drafts.md)); ICO registration; VAT on the 10% commission and invoicing (accountant); whether hosts must be told about HMRC digital-platform reporting; chargeback liability under destination charges. | External (owner) | Instruct solicitor/accountant |
| 3 | **Payment safeguard, ready for review, not merged.** Branch `claude/trader-identity-gate` (`b2b3988`): on Production, refuses new payments (booking, date change, extras, Spotlight) and marks readiness incomplete until blocker 1 is set. Refunds, webhooks, payouts and deposits are unaffected. Merging deploys to Production and closes live checkout until blocker 1 is done. | Code, awaiting approval | Owner approves merge |
| 4 | **Hosts can self-publish.** New listings go live immediately (`Listing.published` defaults to true); admins can only suspend afterwards. With live Stripe on, a stranger could list and take payments before host terms exist. | Owner decision | Keep hosts invite-only until blocker 2, or accept the risk |
| 5 | **Credential rotation unconfirmed.** Production database password was shared in chat on 7 Oct; Vercel `DATABASE_URL` was last changed before that note. The Stripe sandbox key pasted in chat also needs rolling. | External (owner) | Reset database password; update Vercel `DATABASE_URL`/`DIRECT_URL` and GitHub `PROD_DIRECT_URL`; redeploy; roll the sandbox key |
| 6 | **Email delivery unproven.** Settings pass the health check, but no real email has been seen to arrive. | External (owner test) | Password reset to a real inbox; check it isn't in spam |
| 7 | **Backups unverified.** Production backup / point-in-time-recovery setting not visible to Claude; the backup project still holds old data awaiting clean-up approval. | External (owner) | Confirm backups in Supabase; restore drill can follow launch |
| 8 | **No real-money test yet.** Only sandbox tests (11 Oct) have passed. | External (owner), after 1-3 | One real booking and refund ([handover.md](handover.md) Step 4) |
| 9 | Stripe business description still says "service fee per booking"; FYStay now charges hosts a 10% commission. | External (owner) | Edit in Stripe dashboard |
| 10 | **Contact mailboxes unconfirmed.** The site shows `support@`, `privacy@` and `legal@fystay.co.uk` by default (`NEXT_PUBLIC_SUPPORT_EMAIL` / `_PRIVACY_EMAIL` / `_LEGAL_EMAIL` are not set in Production). Nothing confirms those inboxes receive mail. | External (owner test) | Send a test message to each, or set the variables to inboxes you read |

## Open PRs (built 12 Oct; none merged - each merge deploys to Production)

| PR | What | Status |
|---|---|---|
| [#7](https://github.com/fystay/fystay/pull/7) | Refuse new live payments until trader name + address are set (blocker 3) | CI green; waits on blocker 1 + owner approval |
| [#8](https://github.com/fystay/fystay/pull/8) | Hosts must confirm their email before connecting Stripe payouts | CI green; owner approval |
| [#9](https://github.com/fystay/fystay/pull/9) | Spotlight: re-check the 8-slot capacity on payment; refund (and email the host) instead of overselling; 31-min payment pages | CI running; owner approval |
| [#10](https://github.com/fystay/fystay/pull/10) | Date-change payment unavailable: say the booking is unchanged, not "dates are still held" | CI running; owner approval. Shares one import line with #7 (one-line merge for whichever lands second) |
| [#12](https://github.com/fystay/fystay/pull/12) | Checkout + privacy policy say the host sees the guest's email and phone once confirmed (trust standard) | CI running; owner approval |
| [#13](https://github.com/fystay/fystay/pull/13) | Host guide explains how and when hosts get paid (90% share, Stripe schedule, refunds) | CI running; owner approval |

## Checked 12 Oct, no change needed

- Placeholder content: none visible to guests or hosts (only an admin-page example and "Photo coming soon" image fallbacks).
- Trust signals: host badges ("Identity verified", ratings, review counts) come from real data; no hard-coded claims.
- Guest promo codes already need a confirmed email; booking itself doesn't.
- Fees: service-fee and cleaning-fee rows on receipts and summaries only appear for bookings made before the 11 Oct commission change; new bookings show no extra fees.

**Not to be done before blockers 1-2:** enabling live payments, publishing
legal details, or onboarding real hosts.

## Owner decisions still open

- Hosts can't cancel a confirmed booking themselves; support does it from `/admin/bookings`.
- Spotlight prices £15 / £25 / £45 (`src/lib/listingPromotions.ts`).
- Optional settings, only if wanted at launch: `PMS_ENCRYPTION_KEY` (property-management connections), Apple sign-in (`APPLE_*`), `EV_EXEC_NOTIFICATION_EMAIL` (trip-extra orders inbox).
- Branch `claude/admin-assisted-onboarding` (listing approval, unmerged, large): not a launch blocker unless chosen as the answer to blocker 4.

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

**Before launch:** nothing to delete. Keep `ALLOW_PRODUCTION_SEED` unset.

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

## Database connection pooling (investigated and fixed 2 Oct)

**Production fixed.** Production `DATABASE_URL` is the Supabase transaction pooler (6543) with
`?pgbouncer=true&connection_limit=5&pool_timeout=20` (was `connection_limit=1`), deployed in
`dpl_5wVMUCxWzkiQ9YnvYrS8a2rr1dPo`. Check: 35 concurrent requests (25 homepage + 10 search)
all returned 200, with no pool-timeout or database errors.

The database password was reset during the change. Production `DATABASE_URL`, `DIRECT_URL` and
the GitHub `production` secret `PROD_DIRECT_URL` were all updated to it. There was an outage of
about 30 minutes (old credentials) on 2 Oct, 08:00-08:32 UTC, while Production had no listings
or bookings.

**Still open:**
- **Preview** `DATABASE_URL` still has `connection_limit=1` (user `fystay_app`). Add the same
  suffix when convenient.

**Region moved to Dublin (2 Oct).** `vercel.json` now has `"regions": ["dub1"]` (`012ee79`), so
functions run next to the `eu-west-1` database instead of in `iad1` (Washington DC). It was verified on
Preview (`dpl_64wcAbxaPbggF24RU8bhJkBmEioA`), then deployed fresh to Production
(`dpl_9WJQUZfZfxCosrifsFdy6eio8JnY`). Every response's `x-vercel-id` shows `dub1` as the function region.

Measured from the test sandbox, which is in the US, so these times include a transatlantic hop to the client:

| | Before (`iad1`) | After (`dub1`) |
|---|---|---|
| `/api/health` database `latencyMs` | 418 | 11-26 warm (186 on the first, cold call) |
| `/` warm time to first byte | 1.31-1.46s | 0.34-0.41s |
| `/search` warm time to first byte | 0.21-0.44s | 0.27-0.33s |
| Pages that don't touch the database | 0.19-0.41s | 0.25-0.37s |
| Burst of 35 concurrent requests | avg 5.2s, max 7.4s | avg 2.7-2.9s, max 3.6s |

Every Production page checked returned 200: `/`, `/search`, `/login`, `/legal/terms`, `/legal/privacy` and
`/api/health`. There were no error or warning logs on Preview or Production, and no new Sentry issues. Across two
bursts, 1 of 35 requests in each never got a response at the client. The one with an error message
failed in the sandbox's outbound proxy during the TLS handshake (`SSL_ERROR_SYSCALL`). Vercel logged no
non-200 responses for the deployment. Guests in the UK should gain more
than these US-measured numbers show, but that wasn't measured.

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
