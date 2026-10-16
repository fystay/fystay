# FYStay master launch checklist

**The single remaining-work list.** Update this file instead of re-auditing.
When an item is done, move it to COMPLETE with the commit or date.

Last verified: **13 October 2026** (live Stripe Identity and Connect onboarding
tested by the owner; read-only checks of Vercel logs, Sentry, Stripe and
Supabase). The 12 Oct snapshot below is kept as history. Earlier audits are kept
below as history. [handover.md](handover.md) has the background.

Related: [handover](handover.md) · [Stripe and email setup](stripe-and-email-setup.md) ·
[launch runbook](launch-runbook.md) ·
[environment variables](environment-variables.md) ·
[legal drafts](legal-drafts.md)

---

## Verified state (12 Oct 2026, history)

| Area | State | Evidence |
|---|---|---|
| Code | Working branch `claude/airbnb-competitor-1fjjpk` at `1c0eb6f` (merge of release PR #32: #17, #25, #26, #27, #28, #29, #30, #31) | GitHub; every PR head is in the branch history (`git merge-base --is-ancestor`) |
| Production deploy | `1c0eb6f`, Ready and serving `www.fystay.co.uk` / `fystay.co.uk` since ~17:32 UTC 12 Oct | Vercel deployment `dpl_6Um84ppqMAPApsVps8k2z7PWbyaA`; live pages carry Sentry release `1c0eb6f` |
| Production health | `/api/health`: status ok, database ok, config ok | Fetched 12 Oct 17:33 UTC |
| Live features (checked 17:33-17:36 UTC, signed out) | Header: "· Apartments · B&Bs · Lodges"; desktop tabs inline in the header (hidden below `lg`); phones/tablets get the fixed bottom tab bar (Stays, Explore, Travel, Services; hidden at `lg`). Search: suggestions answer (landmarks only, see Catalogue); `GET /api/listings` without dates gives 400 "Add a check-in date"; landmark + dates + `propertyType=LODGE` + price filter gives 200; `/search` with dates renders "No stays match your search". `/api/search/place` gives 503 (no Google key, expected). Hotels: "Hotel search is unavailable" (no live partner; test hotels are blocked on Production by design), so hotel booking links can't be exercised live. `/admin/properties` and `/host/calendar` send signed-out visitors to login; the calendar export answers 404 for an unknown listing/token | Fetched through Vercel; signed-in admin and calendar sync screens not exercised on Production (no Production test account; covered by the release's browser tests) |
| Production settings | Database, Auth, base URL and `NEXTAUTH_URL` (www domain), cron, 2FA key, Supabase, Sentry, Google sign-in, Resend key, `EMAIL_FROM` on own domain, dispute inbox, live Stripe key, both live webhook secrets: all present | Vercel variable names (values never read); health check confirms the Stripe key is live |
| Stripe live account | Charges and payouts enabled, identity verified, bank account linked, statement descriptor `FYSTAY`; account type: individual | Stripe API, read-only |
| Live webhooks | Account-events and connected-accounts endpoints enabled on `https://www.fystay.co.uk/api/webhooks/stripe` | Stripe API, read-only; no live event delivered yet |
| Production database | 62 migrations applied, latest `20261012170000_listing_location_index`, none unfinished. PropertyType has BED_AND_BREAKFAST and LODGE; `Listing_latitude_longitude_idx` exists; HostInvitation, ListingReviewEvent and AdminAuditEvent have row-level security on; iCal sync error columns present | Migration run 38284206307 (owner-approved, success 12 Oct ~17:29); read-only SQL 17:31 UTC. Old run 38244398792 cancelled (superseded) |
| Catalogue | 0 listings live, so town suggestions are empty (they come from towns with live stays) and search returns no stays | Live `/api/listings` and suggestions, 12 Oct 17:33 |

## Verified state (13 Oct 2026)

| Area | State | Evidence |
|---|---|---|
| Production deploy | `5923a71` (#46), then #47 when approved; health ok | Vercel `dpl_G5okwZqVrjMyKUmfJzFfjABK2YPa`; `/api/health` 13 Oct 14:06 UTC |
| Email verification at sign-up | Live (#36) | Merged 13 Oct |
| Real email delivery | Works | hello@fystay.co.uk confirmed through the emailed link, 13 Oct 01:54 UTC |
| Admins | hello@fystay.co.uk and the original Gmail account | Granted 13 Oct at the owner's request |
| Stripe Identity | **Live.** Activated by the owner 13 Oct; a live verification session was created for the owner's host account (status PENDING until they finish the ID + selfie) | Production DB, read-only |
| Stripe Connect | **Live.** First connected account `acct_1UQ6NfE6g0pKrmpo` (owner's host account): `stripe_transfers` and `payouts` active, no requirements; FYStay shows "Payouts active" | Stripe API (read-only), payouts page |
| Connect platform profile | Completed by the owner as "Sellers collect payments directly", Stripe liable, full Dashboard - not the marketplace setup. Live refused recipient-only accounts (`capability_not_available_without_other_capability`), so #46 requests `card_payments` alongside `stripe_transfers`; checkout is still destination charges. Stripe Support case opened 13 Oct to correct the profile (reply due within 24h) | Vercel logs, Sentry JAVASCRIPT-NEXTJS-A |
| Catalogue | 0 published listings | Production DB |

## LAUNCH BLOCKERS (outstanding, rechecked 16 Oct)

16 Oct, read-only: health ok (status, database, config); Production database has 0 listings, 0 bookings, 5 users. Open PRs waiting on the owner: #7 (blocker 1), #9 (Spotlight), #52 (nightly backup: needs the read-only login and two secrets, see its runbook), #53 (smart pricing: migration + solicitor first).

| # | Blocker | Owner action |
|---|---|---|
| 1 | **Trader identity.** Entity not decided, so `NEXT_PUBLIC_COMPANY_LEGAL_NAME` / `_ADDRESS` (+ `_NUMBER` for a company) aren't set and #7 can't merge. **Never publish placeholder details.** | Decide sole trader or Ltd and the address to publish |
| 2 | **Legal sign-off.** Solicitor review of Terms, Privacy, Cookies, cancellation wording; host terms (draft in [legal-drafts.md](legal-drafts.md)); ICO registration; VAT on the 10% commission; HMRC platform reporting; chargeback liability. | Instruct solicitor/accountant; register with the ICO |
| 3 | **No listings.** 0 published. New listings now get a map position anywhere in the UK (#49). | Create and approve the first listings (Admin → Add a property → Approve listing) |
| 4 | **No real-money test yet.** | After 1: one real booking, cancellation, refund and payout ([handover.md](handover.md) Step 4) |

**Should do before launch:** confirm Supabase backups / point-in-time recovery; test support@, privacy@ and legal@ inboxes; change the Stripe business description to the 10% host commission; decide payout timing (at booking today, or after check-in); retake the Connect platform profile as Stripe Support asked on 14 Oct (marketplace: FYStay collects payments, pays hosts by destination charges, FYStay responsible for negative balances), then merge #55 (hosts back to transfers only) and retry one host onboarding - send Stripe the request ID if it fails; final phone and desktop check once listings exist. Redeploys: choose the latest `claude/airbnb-competitor-1fjjpk` deployment - redeploying a PR branch's deployment as Production put unmerged code live twice on 13 Oct.

**Done 13 Oct (owner, confirmed):** database password rotated (Vercel + GitHub secret, health ok); Stripe sandbox key rolled (Preview only); Google sign-in fixed on www and consent screen published; Vercel production branch confirmed as `claude/airbnb-competitor-1fjjpk`; real email delivery proven; Stripe Identity activated; Connect onboarding live; owner's own ID check **verified** by Stripe (session `vs_1UQ6VxCgubLh6wuSBGPKXE9U`, document + matching selfie, `identity.verification_session.verified` at 14:18 UTC, webhook delivered; FYStay shows VERIFIED).

**Done 13 Oct (Google Maps, #49/#50):** `GOOGLE_MAPS_API_KEY` (server, Places API (New)), `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (Maps JavaScript, website-restricted) and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` set for Production and Preview. Verified live 21:33 UTC: suggestions for "Manchester" come from Google; the search page's security policy allows Google Maps. Google refusals are now logged with their reason (#50).

## PRs (13 Oct)

**Merged 13 Oct (later):** #47 payouts page auto-refresh · #48 short /privacy, /terms, /cookies links · #49 UK-wide search with Google Maps · #50 Google refusal logging.

**Merged and live 13 Oct:** #36 email verification · #37 identity retry cap · #38-#41 homepage, stay cards, booking-box sign-up link · #42 Now covering strip · #43 hero photos · #44 Liverpool and Manchester in Now covering · #45 Connect/Identity error handling and live status · #46 card_payments alongside transfers for host accounts.

**Open:** #7 trader-identity payment gate (waits on blocker 1) · #9 Spotlight overselling safeguard (owner review).

## PRs (12 Oct)

**Merged 12 Oct** (into `claude/airbnb-competitor-1fjjpk`, CI green):
[#8](https://github.com/fystay/fystay/pull/8) hosts confirm their email before connecting payouts ·
[#10](https://github.com/fystay/fystay/pull/10) date-change "payment unavailable" message ·
[#12](https://github.com/fystay/fystay/pull/12) checkout + privacy say the host sees the guest's email and phone once confirmed ·
[#13](https://github.com/fystay/fystay/pull/13) host guide explains how and when hosts get paid ·
[#14](https://github.com/fystay/fystay/pull/14) migration revoking API access to `rls_auto_enable()` (applied on Production 12 Oct, run 38284206307) ·
[#15](https://github.com/fystay/fystay/pull/15) admin nav landmark label.

**Open, waiting on the owner:**

| PR | What | Waiting on |
|---|---|---|
| [#7](https://github.com/fystay/fystay/pull/7) | Refuse new live payments until trader name + address are set (blocker 3) | Blocker 1 (legal entity) + approval. Merging closes live checkout until the two settings exist. |
| [#9](https://github.com/fystay/fystay/pull/9) | Spotlight: re-check capacity on payment; refund + email the host instead of overselling; 31-min payment pages | Approval: changes the live Stripe webhook and Spotlight payments |

**Release 12 Oct: live.** Release PR [#32](https://github.com/fystay/fystay/pull/32) (branch `claude/release-2026-10-12` at `bd9d389`, CI green: unit/typecheck/lint/build and browser tests) merged as `1c0eb6f` at ~17:30 UTC after migration run 38284206307 applied `20261012120000`-`170000`. #17, #25, #26, #27, #28, #29, #30 and #31 are all in it (heads verified in history); GitHub marked them merged. Post-deploy checks: see "Verified state".

**Merged 12 Oct (later):** #16, #18 (password show/hide), #19 (Google Places search), #20, #21, #22 (calendar re-sync before booking), #23 (hello@ sender), #24. Working branch now `d5ba58c`.

**Location search without a Google key (verified locally, no key set):** FYStay's own suggestions work: towns with stays or a destination page, curated landmarks, and stay names. Town and landmark searches return results by name and by a 5-mile area. **Unavailable until `GOOGLE_MAPS_API_KEY` is set** (server-side key, Places API (New) enabled, billing on, no referrer restriction): suggestions for any other place, postcode or address, and the place-details lookup (`/api/search/place` answers 503). A guest can't type a postcode and search; they pick a town or landmark instead.

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

- Twilio phone verification (`TWILIO_*`): code flow built and tested (#28, deployed); off in Production until the three settings are added.
- Ticketmaster events on destination pages (`TICKETMASTER_API_KEY`).
- Booking.com hotel affiliate. Credentials alone never switch it on: the code must also list it in `LIVE_HOTEL_PROVIDER_CODES`.
- PMS integrations: Cloudbeds is built, SiteMinder and SuperControl are stubs.
- Uptime monitoring: `.github/workflows/uptime-production.yml` checks `/` and `/api/health` every 30 minutes once merged (GitHub emails on failure). Backups: Supabase Free plan has none; #52 adds a nightly backup.
- A test-timezone tidy-up: the hotel deep link used the wrong day on UK summer time; fixed in [#31](https://github.com/fystay/fystay/pull/31) (open).

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
