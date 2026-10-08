# Production-readiness audit (7 October 2026, evening)

The final check before real guests and real money. Four independent reviews were run in parallel, and every finding was checked against the code before anything was changed:

- money lifecycle
- email and monitoring
- guest journey, trust and scale
- manipulation and security

Branch: `claude/host-platform-upgrade`. **Nothing has been deployed to the live branch.**

This follows [pre-production-audit.md](pre-production-audit.md), which covers the host platform and perceived performance.

## Verdict

**The code is ready for a small, careful launch once the two database updates have run. The business is not ready to take real money yet.** What stands between them is configuration and three decisions, not code:

- Stripe live
- email on your own domain
- company details on the site
- one real-money test

Passing tests do not make it production ready on their own. What would actually break today if real guests arrived is listed under 🔴.

## Scorecard (out of 100, as it stands today)

| Area | Score | Why not higher |
|---|---|---|
| Backend reliability | 85 | Solid locking, idempotency and claim-first patterns throughout. |
| Payment reliability | 78 | Every flow is built and tested in Stripe test mode, but **none has run with real money yet**. Dispute clawback and Dashboard-refund reconciliation are policy decisions still open. |
| Security | 79 | No critical holes. Password sign-ups don't verify the email address, which enables referral-credit farming and "squatting" on someone's address. 2FA isn't asked for on Google/Apple sign-in. |
| Host experience | 80 | Dashboard, earnings, calendar and deposits are strong. Missing: host self-cancellation, per-date pricing, automated guest messages. |
| Customer experience | 74 | A clear journey with good recovery states. The headline price excludes the service fee. There's no countdown on the 30-minute hold, and an account is needed to book. |
| Performance | 86 | 23–117ms server, LCP 110–310ms, CLS 0 at today's size. |
| Accessibility | 88 | 0 axe issues on every hosting page and on the changed guest pages, desktop and phone. |
| Scalability | 66 | Fine to a few hundred listings. The homepage and search load every listing with its full booking history; see §13. |
| Revenue / upsell readiness | 55 | Trip extras work, but are the same offer everywhere, are a second payment, and don't collect flight details. No per-date or seasonal pricing. |
| Production monitoring | 70 *once Sentry is on* (**~25 today**) | Now built in this pass. Until `SENTRY_DSN` is set and an uptime monitor points at `/api/health`, a 2am failure reaches no one. |

## What was fixed in this pass

Each fix has tests. Results: **1,349/1,349 unit tests, 115/115 browser tests** on a production build, lint 0 errors, typecheck clean, axe 0 issues, no sideways scrolling at 390px.

### Money

| Severity | Problem | Fix |
|---|---|---|
| High | A host could change their cancellation policy (e.g. Flexible → "no refund") after guests had booked. Existing guests' refunds followed the new policy. | The policy the guest saw is **saved on the booking** and used for every refund, display and email. Older bookings fall back to the listing. *New database column.* |
| High | Promo codes and referral credit bigger than FYStay's 10% fee came out of the **host's payout**. Example: a £60 stay with £10 credit paid the host £4 less, contradicting "that's what you earn". | Discounts are capped at FYStay's own fee on that booking. Unused credit stays on the guest's account. *Your decision to revisit: see Decisions.* |
| Important | The deposit hold was placed 3 days before check-in, but card holds last only 7 days. On any stay of a few nights the hold expired before the host's claim window closed. Claims then failed, and the daily job retried a dead hold forever. | The hold is placed **the day before check-in**. The claim deadline never outlives the hold, using Stripe's own expiry for that card. Extended (up to 30-day) lodging holds are requested where your Stripe pricing allows. An expired hold is recorded as released, with a clear message to the host. |
| Important | A guest who paid near the end of their 30-minute hold could be **refunded in favour of someone who reserved later and hadn't paid**. | When a payment arrives, only paid stays can beat it. The unpaid reservation finds the dates taken when it tries to pay. |
| Medium | A host could claim a deposit after the claim deadline, until the daily job ran. | Refused once the deadline has passed. |
| Medium | Chargeback alerts and payment alerts were lost for good if the email failed (the "already alerted" record was kept anyway). | Alerts now fail loudly, the record is released, and Stripe's retry sends the alert again. |
| Medium | The cancellation email told a guest they'd get the full refund even when Stripe refused part of it. | It states what actually went back. |
| Low | A guest could move a stay into the past through a date-change request. | Refused, the same as a new booking. |
| Low | Cancelling an unpaid booking left its Stripe payment page payable. | The page is closed when the booking is cancelled. |
| Low | A cancellation racing a date-change payment could refund from the old total. | The cancellation only proceeds against the total it read. |
| Low | Events from inside hosts' own Stripe accounts would have been retried for days. | Ignored, except `account.updated`. |

### Notifications and monitoring (§3, §4)

| Problem | Fix |
|---|---|
| **The email service never reports a refused email.** It returns an error instead of failing, and the code never checked it. A bad sending address, unverified domain or rate limit meant confirmations, password resets and ops alerts **vanished without trace**. | Every refused email is logged and reported to Sentry, in one place for all ~19 emails. Ops alerts throw, so they retry. |
| Arrival reminders, review requests and the transfer offer were marked "sent" even when sending failed. | They're only marked sent once the email is accepted, otherwise retried the next day. |
| With no `EMAIL_FROM`, every email goes from Resend's test sender, which **only delivers to your own inbox**. | New `/api/health/config` lists every missing or wrong production setting: names and consequences, never values. It answers "not ready" while any blocker is missing. `/api/health` shows `"config":"ok"` or `"incomplete"`. |
| Daily jobs failing or not running alerted nobody. | Each of the 6 jobs checks in with **Sentry Crons**: missed or failed runs alert you. Only an authorised run checks in, so strangers can't fake a failure. |
| ~20 caught errors in refunds, deposits, payouts and daily jobs went only to the log. | Reported to Sentry, tagged `payments` / `deposits` / `cron` / `email`, so you can alert on payments specifically. |

### Guest journey and trust (§5, §8)

| Problem | Fix |
|---|---|
| A promo code discount was missing from the checkout and confirmation summary. The lines added up to more than the total charged. | A "Promo code −£X" line is shown. |
| The security deposit was first mentioned at checkout. The listing said "the total above is everything you pay". | The booking widget says up front: refundable hold, the day before check-in, released unless there's damage. |
| Checkout never said what the guest agrees to by paying. There was no support contact. | "By paying, you agree to FYStay's Terms and this stay's cancellation policy", plus the support email. |
| The calendar feed hosts sync to Airbnb hid pending requests (held for up to 24h), so the same dates could be sold twice. | Requests and in-progress checkouts are exported as "Held". The feed is cached for 15 minutes, not 60. |
| Every public listing view read every message the host ever sent. | Bounded to the last year, matching the host dashboard. |

### Google/Apple host sign-up (§11)

**Done, safely.** "I want to: Book stays / Host my place" now sits *above* the Google/Apple buttons. Choosing "Host my place" carries the intent through Google or Apple. After sign-in the new account lands on **"You're signed in. Ready to host?"** with a single **Start hosting** button, instead of the guest homepage.

**Why one tap rather than automatic:** the role can't be trusted through the provider round trip. Automatically upgrading on a link would let anyone who sends a signed-in guest that link change their account. The one tap uses the existing, protected "become a host" action. Existing hosts go straight to their dashboard.

## 1. Real-money payment lifecycle

| Scenario | What happens | Verified |
|---|---|---|
| Success | A webhook confirms only a paid session for the exact amount in GBP, re-checking the dates under a per-listing lock. Confirmation emails go out after the database commit. | ✅ |
| Failed payment | Booking stays unpaid. The hold lapses after 30 min. Credit and promo are returned once. | ✅ |
| Abandoned | The expired event or the hourly sweep closes it and returns discounts. | ✅ |
| Duplicate webhook | No-op; no second email. | ✅ |
| Late webhook (after expiry or cancel) | Refunded in full, once. | ✅ |
| Out of order | `charge.refunded` arriving first is harmless. | ✅ |
| Refund (guest cancels) | Claimed before money moves. Proportional across all payments, newest first, reversing the host's share and FYStay's fee. A partial failure alerts you and records what went back. | ✅ |
| Partial refund in Stripe Dashboard | **Alert only.** The booking isn't updated and the host's share isn't reversed. | ⚠️ Decision |
| Cancellation (support/admin) | Same path, with an override %. | ✅ |
| Date change | Priced server-side and re-checked under the lock. One change at a time. Mismatched payments refunded. | ✅ |
| Deposit hold / claim / release | Claim-first, transfer to host with an idempotency key and source charge, retried daily. Now fits the card hold's lifetime. | ✅ (fixed) |
| Host not payout-ready | Checkout refuses until Stripe says the host can receive transfers, checked live. | ✅ |
| Host account restricted after payment | The money is already in the host's Stripe balance; Stripe holds it until resolved. FYStay isn't told. | ⚠️ Low (`payout.failed` not handled) |
| Dispute / chargeback | Recorded and alerted. **FYStay bears the full loss** (the host keeps their share). | ⚠️ Decision |
| Anything time-based | 30-min hold vs 31-min payment page (fixed); deposit hold vs claim window (fixed); daily jobs (now monitored). | ✅ |

## 2. Stripe live checklist

**Already implemented (code):**
- Checkout and Connect destination charges (host gets nightly rate + cleaning; FYStay keeps the service fee, pays card fees).
- Accounts v2 recipients.
- Refunds with transfer and fee reversal.
- Deposits (hold, claim → transfer, release).
- Disputes recorded and alerted.
- Webhook signature checks against two secrets.
- Amount and currency checks.
- Idempotency keys.
- Live readiness check per host.
- Live balance on the host Earnings page.
- Extended deposit holds requested.
- `/api/health/config` refuses a test key in Production.

**Needs Vercel config (Production only; you add the values):**
- `STRIPE_SECRET_KEY` (live, `sk_live_…`)
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_WEBHOOK_SECRET`

Today none are set. Test keys stay on Preview only. (No publishable key is needed: checkout is Stripe's hosted page.)

**Needs Stripe Dashboard config:**
1. Activate the live account: business details, bank account, identity. Charges, payouts and details are all off today (`acct_1UNcL1CgubLh6wuS`).
2. Connect in live mode: platform profile, UK recipients, losses handled by the platform, branding.
3. Statement descriptor, e.g. `FYSTAY`, so guests recognise the charge and disputes stay down.
4. Optional: ask Stripe about **extended authorisations** (lodging, up to 30 days) on your pricing plan. This gives hosts a full 3-day claim window on longer stays.
5. Turn on Stripe's email alerts for failing webhooks and disputes, to an inbox you read.

**Needs webhook config (two live endpoints, both `https://<live domain>/api/webhooks/stripe`):**
- **Your account:**
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`
  - `charge.refunded`
  - `refund.failed`
  - `identity.verification_session.verified`
  - `identity.verification_session.requires_input`

  Its signing secret goes in `STRIPE_WEBHOOK_SECRET`.
- **Connected accounts:** `account.updated`. Its signing secret goes in `STRIPE_CONNECT_WEBHOOK_SECRET`.

**Needs a real-money test (you, on the live site, with your own card, small amounts). Run each and check the result:**

| # | Test | Check |
|---|---|---|
| 1 | Book a £1-a-night test listing owned by a second account of yours that has finished Stripe payout setup | Confirmation email arrives; host sees it; the Stripe payment shows the transfer to the host and FYStay's fee |
| 2 | Cancel within the free window | Refund appears; host share and fee reversed in Stripe |
| 3 | Book with a deposit; authorise the hold the day before check-in | Hold appears on the card |
| 4 | Claim £1 of it as the host | Captured and transferred to the host |
| 5 | Release a second hold | Disappears from the card |
| 6 | Start a checkout and abandon it | Dates free up within 30 min |

## 3. Email and notifications

Every email goes through Resend (`RESEND_API_KEY`, `EMAIL_FROM`). Ops alerts go to `DISPUTE_ALERT_EMAIL`, falling back to the support address.

**No email failure can undo or corrupt a booking or a payment.** Every email is sent after the database write, outside the transaction.

| Email | Trigger | To | If it fails |
|---|---|---|---|
| Booking confirmed | Payment webhook (after commit) | Guest + host | Reported; not retried (the booking is correct, the guest sees it under My trips) |
| Payment couldn't be used, refunded | Webhook | Guest | Reported |
| Request received / accepted / declined / expired | Booking request, host response, daily job | Host / guest | Reported |
| Booking cancelled | Cancellation | Guest + host | Reported. Now states the amount actually refunded |
| Deposit: please authorise / released / claimed | Daily job, host action | Guest | Reported |
| Arrival reminder, review request, transfer offer | Daily job | Guest | **Retried next day** (fixed) |
| Trip extra: provider job / guest confirmation | Purchase | Provider / guest | Provider failure marks the extra FAILED for follow-up |
| Spotlight placement confirmed | Payment | Host | Reported |
| Password reset, email change | User action | User | Reported |
| **Ops:** chargeback, Dashboard refund, failed refund, partial refund, deposit transfer failed | Webhook, cancellation, daily job | You | **Retried by Stripe** / daily (fixed); in Sentry if email isn't set up |
| SMS phone code | User action (Twilio Verify) | User | Shown to the user |

**Monitoring of email:** Sentry, once the DSN is set, receives every refused email, tagged `email`. Watch the Resend dashboard for delivery and bounce rates in the first weeks.

## 4. "If something breaks at 2am, how will I know?"

**Today: you wouldn't.** After you complete the four steps below:

| Failure | How you hear |
|---|---|
| Site or database down | Uptime monitor on `/api/health` (texts or calls you) |
| A setting missing or wrong after a change | The same monitor, set to require `"config":"ok"` |
| Any server error | Sentry email/app push |
| A refund, deposit or payout problem | Sentry, tagged `payments`/`deposits`, plus an ops email |
| A daily job failed or didn't run | Sentry Crons |
| Emails refused | Sentry (`email`) |
| Chargeback | Ops email + Stripe's own email |
| Stripe can't reach the webhook | Stripe's own failing-webhook email |

**Your four steps:**
1. Create a Sentry project. Add `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in Vercel Production.
2. In Sentry, add an alert rule "issue tagged area:payments → notify me immediately". Turn on the phone app.
3. Free UptimeRobot or Better Stack: a keyword monitor on `https://<live domain>/api/health` expecting `"config":"ok"`, every 5 min, with SMS.
4. Set `DISPUTE_ALERT_EMAIL` to an inbox you read daily.

## 5. Customer journey

Walked from homepage to confirmation in code, with the money paths tested end to end. The changes made are under "What was fixed" above.

Still open:
- **Headline price excludes the 10% service fee.** UK pricing law (DMCC Act 2024) expects compulsory fees in the headline price; see Decisions.
- No live countdown on the 30-minute hold (the guest learns it lapsed only when they press Pay).
- The confirmation email doesn't yet include the address or check-in time. They come with the arrival reminder 2 days before.
- Booking needs an account. The selection is kept through sign-in, so this is a conversion cost, not a bug.
- No limit on how far ahead someone can book. With one flat nightly price, next August can be booked at today's rate (see per-date pricing, §12).
- Card prices convert to other currencies for display while checkout is in GBP. The pages say so, but the numbers differ.

## 6. Discoverability of services and upsells

Extras are shown on:
- the listing page (transfer)
- the confirmation page
- the trip page
- the travel section
- one pre-arrival email

They're deliberately not at checkout, which is the right call.

Gaps, in order of value:
1. **Ask for flight number and arrival time when a transfer is bought.** Today the provider is told to contact the guest.
2. **Make offers contextual.** No transfer offer for guests at a listing with parking who are driving; different offers per town.
3. Later, let hosts sell their own extras (late checkout, breakfast). That needs the change below.

## 7. Upsell architecture

What exists:
- `ExtraProvider` → `ExtraOffering` (a global catalogue, flat price)
- → `BookingExtra` (attached to a booking, with the price copied at purchase, notes, and a fulfilment state)

Covered today:
- **Booking:** ✅
- **Customer:** ✅ via the booking's guest

**To also attach to destination, listing and dates without a rebuild:** one additive migration of nullable columns.

On `ExtraOffering`:
- `townSlug`
- `listingId` / `hostId` (empty = everywhere)
- `availableFrom` / `availableTo`
- a `priceUnit` (per booking / per guest / per night)

On `BookingExtra`:
- `serviceDate`
- `quantity`
- structured `details` (flight, pickup)

No existing data changes. Not built now, since it isn't needed for launch.

## 8. Customer trust

Already strong:
- verified-host and Great Host badges
- reviews only from completed paid stays
- the cancellation policy on the listing, widget and checkout
- Stripe secure-payment wording
- terms, privacy, cookies, help and safety pages

Still missing:
- **Company legal name and address are not set**, so Terms, Privacy and the footer don't name the operator. UK e-commerce rules require it. Set `NEXT_PUBLIC_COMPANY_LEGAL_NAME`, `NEXT_PUBLIC_COMPANY_NUMBER` and `NEXT_PUBLIC_COMPANY_ADDRESS`.
- A refund timeline line ("refunds reach your card in 5–10 working days") on cancellation screens.
- Listings with no reviews could lean harder on host verification and response rate.

## 9. Host commercial value and retention

Strong today:
- a clear Today view
- earnings that reconcile to the penny
- a live Stripe balance
- the calendar with iCal sync
- deposits
- Spotlight placements
- a Great Host progress tracker

What makes a host stay, or leave, next:
1. **Per-date / seasonal pricing.** Blackpool's peak weekends and illuminations are where hosts earn. One flat rate leaves money on the table every week. *Highest-value next build.*
2. **Host self-cancellation** (§10).
3. **Automated guest messages** (check-in instructions, the day-before message).
4. **Real-time channel sync** (§12).
5. A monthly earnings statement or CSV for their accountant.

## 10. Host cancellation: proposed rules and the decisions you need to make

Proposed mechanics (ready to build once you decide):
- The host cancels from the booking page and gives a reason.
- The **guest always gets 100%** back, including the service fee.
- The host's share and FYStay's fee are reversed.
- The cancelled dates are **blocked** so the host can't re-sell them at a higher price.
- The cancellation is counted on the host's record.

The cancellation code already supports a 100% override.

**Decisions only you can make:**
1. **Penalty for the host?**
   - Options: none / a flat fee (e.g. £50) / a % of the booking / tiered by how close to check-in.
   - Note: Stripe recipient accounts can't simply be charged, so a penalty would be taken from the host's *next* payout. That needs a small extra build.
2. **Who absorbs Stripe's non-refundable processing fee** on the refunded payment (about 1.5% + 20p)? FYStay or the host?
3. **Limits:** after how many host cancellations in 12 months do you warn, hide or suspend a listing? Does a cancellation block Great Host for a period?
4. **Exceptions:** which reasons waive the penalty (flood, illness, guest misconduct), and who decides? You, via support?
5. **Guest goodwill:** do you add rebooking credit on top of the refund (e.g. 10%)?
6. **Late cancellations:** may a host cancel within 24–48 hours of check-in themselves, or only through support?

## 11. Google host onboarding

Done; see "What was fixed" above.

## 12. Channel-manager readiness (Channex not integrated, as instructed)

Ready:
- a clean provider-adapter layer with Cloudbeds built (SiteMinder/SuperControl stubbed)
- encrypted credentials, row-level-security-scoped access
- idempotent reservation push
- de-duplicated webhook events
- iCal import/export with idempotent upserts

Missing before a channel manager could plug in, in this order:
1. A **per-date rate and restrictions table** (price, min stay, closed to arrival/departure). This also unlocks seasonal pricing (§9).
2. **Bookings from other channels as real bookings:** a `channel` field and the external reservation id.
3. An **outbox** of availability and rate changes for the channel manager to read.
4. **Partial room inventory** for hotels: one imported reservation currently closes a whole room type.

Until then, iCal is the bridge. Its double-booking window is now shorter: pending requests are exported and the feed is cached 15 min, but imports still run once a day.

## 13. Database and scalability

| Scale | Verdict |
|---|---|
| 10 hosts | Comfortable. Every page is fast. |
| 1,000 hosts | **Homepage and search will slow and then time out.** They load every published listing, its reviews, and every booking it has ever had (search caps at 500 listings and silently drops older ones beyond that). The admin overview sums revenue in code. |
| 10,000 hosts | Additionally: the daily iCal sync runs listings one after another inside 60 seconds (it times out at a few hundred feeds); host pages load a host's full history. |

What to do before ~300 listings (≈1 day of work, no visible change):
- Paginate and bound the homepage and search queries.
- Only load future bookings for availability.
- Add indexes:
  - Booking `(listingId, status, checkOut)`, `(status, checkIn)`
  - Listing `(published, suspendedAt, createdAt)`
  - Message `(conversationId, createdAt)`
  - AvailabilityBlock `(listingId, endDate)`
- Move the admin totals to database sums.
- Fan the iCal sync out in batches.

Connections: Production uses Supabase's transaction pooler (5 per function), which suits Vercel.

## 14. Security: "Can a malicious customer or host manipulate something?"

- **Prices, fees, amounts, deposits:** all recomputed on the server. Nothing a browser sends changes what is charged. ✅
- **Another user's data** (host↔host, guest↔guest): every route checks ownership; admin checks role. ✅
- **Making yourself admin, verified, or changing your Stripe account:** not possible; only allowed fields are accepted. ✅
- **Fake reviews:** need a completed, paid stay; one review per booking. ✅
- **Webhooks and scheduled jobs:** signed or secret-checked in constant time. ✅
- **SSRF via calendar import:** blocked (private networks, metadata endpoints and redirects all checked). ✅
- **XSS:** none found. ✅
- **Changing the cancellation policy after booking:** **fixed**.
- **Discounts eating the host's payout:** **fixed**.
- **Late deposit claims:** **fixed**.
- **Past-date changes:** **fixed**.

Still open:

| Issue | Severity | What it allows |
|---|---|---|
| No email verification for password sign-ups | 🟠 Medium | Throwaway accounts can collect £10 welcome credit each (now capped at FYStay's fee). Someone can register *your* address first and attach their own Google account. Fix: verify the email before credit, linking or booking. |
| Promo codes have no per-person limit | 🟠 Medium | A "first booking" code works on every booking. |
| 2FA not asked on Google/Apple sign-in | 🟠 Low | An account with 2FA and Google linked can sign in through Google without the code. |
| iCal export token can't be rotated | 🟢 Low | |
| PMS property id not ownership-checked | 🟢 Low | Unreachable while PMS webhooks are off. |
| Photo URLs accept any https address | 🟢 Low | A host could use a tracking pixel. |
| Upload extension comes from the filename | 🟢 Low | |

## 15. UI

Only real problems were fixed: the promo line, deposit disclosure, checkout agreement and support line, and the sign-up role choice moved above Google/Apple. Each was checked on desktop and a 390px phone: axe 0 issues, no sideways scroll.

## 🔴 BLOCKERS (before the first real booking)

1. **Run the two database updates** through the "Production database migration" workflow (steps below). Both are additive and safe on existing data.
2. **Stripe live:**
   - activate the account
   - enable Connect live
   - add the 3 live keys in Vercel Production
   - add the two live webhook endpoints (§2)
3. **Email:** `RESEND_API_KEY` is already set in Production. Still needed:
   - a verified sending domain in Resend
   - `EMAIL_FROM` on that domain

   Without these, **no guest or host email is delivered at all** (Resend's test sender only reaches your own inbox).
4. ~~`CRON_SECRET`~~: checked on 7 Oct, already set in Production, so the daily jobs will run.
5. **Company details:** legal name, company number, registered address (three `NEXT_PUBLIC_COMPANY_*` variables).
6. **Pricing display decision** (UK DMCC Act). Should the 10% service fee be included in the headline price on cards and listing pages? Recommended: yes, show "£X per night incl. fees" and the full total once dates are picked. It's a few hours' work once you say so.
7. **The real-money test run** (§2), then check `/api/health` shows `"config":"ok"`.

## 🟠 IMPORTANT (first weeks)

- Sentry + uptime monitor + `DISPUTE_ALERT_EMAIL` (§4). Without them, failures are silent.
- Email verification for password sign-ups, and per-person promo limits.
- Decisions:
  - dispute clawback (recover the host's share on a lost chargeback, or keep absorbing it)
  - Dashboard-refund handling
  - host cancellation (§10)
- Collect flight and arrival details for transfers.
- Confirmation email with address and check-in time; countdown on the 30-minute hold.
- 2FA on Google/Apple sign-in.
- The ~1-day scale work in §13, before ~300 listings.

## 🟢 POST-LAUNCH

- Per-date and seasonal pricing (the biggest host-revenue lever) and channel-manager groundwork (§12).
- Contextual and host-sold extras (§7).
- Guest checkout without an account.
- Listing JSON-LD as a vacation rental (not "Product") and readable listing URLs.
- `payout.failed` handling.
- iCal token rotation, photo URL allow-list, upload checks.
- Removing the unused `refundChangeDifference`.

## Decisions made for you in this pass (easy to reverse)

- **Discounts are capped at FYStay's fee per booking**, so hosts are always paid their price. If you want bigger promotions, FYStay must fund them from its own balance with a separate transfer to the host; that's a small build.
- **Deposit holds are placed the day before check-in** (was 3 days), so the claim window survives on longer stays.

## Releasing

1. GitHub → Actions → **Production database migration** → Run workflow:
   - branch `claude/host-platform-upgrade`
   - `sha` = the branch's latest full commit SHA
   - drift check `report`

   Approve it. It applies:
   - `20261007090000_add_deposit_transfer`
   - `20261007200000_snapshot_booking_cancellation_terms`

   Both only add empty optional columns and one index. Both have already been applied to Preview.
2. When it's green, tell Claude to merge the branch into `claude/airbnb-competitor-1fjjpk` (which deploys).
