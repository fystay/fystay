# FYStay Launch Readiness

## The goal

FYStay is ready to launch when a real person who doesn't know us can:

1. Discover FYStay
2. Create an account
3. Search for accommodation
4. Find a listing they trust
5. View the property, photos, amenities, pricing and reviews clearly
6. Save/favourite a property
7. Make a booking
8. Pay successfully
9. Receive the correct confirmation emails
10. Manage their booking
11. Cancel/refund where applicable
12. Contact the host where appropriate

At the same time, a real host must be able to:

1. Create an account
2. Complete onboarding
3. Create and publish a listing
4. Add photos, pricing, availability and amenities
5. Receive a booking
6. View the guest and booking details they are entitled to see
7. Manage the booking
8. Communicate with the guest
9. Receive their payout through Stripe Connect

## Launch standard

The experience must feel like a professional, trustworthy travel marketplace.

We are not aiming for "the code works". We are aiming for:

> **A stranger can use FYStay from start to finish without needing help from us.**

There should be no:

- Broken buttons
- Dead links
- Unclear errors
- Missing loading states
- Confusing terminology
- Unexpected fees
- Broken mobile layouts
- Authentication problems
- Booking/payment inconsistencies
- Missing confirmation emails
- Incorrect booking states
- Duplicate bookings or payments
- Security/privacy leaks
- Fake or misleading trust signals
- Placeholder content visible to real customers
- Features that appear available but don't work

## Trust standard

Every important customer decision should be clear.

Customers should understand:

- What they are booking
- Who they are booking from
- The total price
- Any compulsory fees
- Cancellation terms
- What happens after payment
- How to contact support
- What information is shared with the host

Hosts should understand:

- What they earn
- When they get paid
- Their responsibilities
- Booking/cancellation rules
- What information guests receive

**Never use fake reviews, fake verification or misleading claims to manufacture trust.**

## Production readiness

Before launch:

- [ ] Stripe Live configured
- [ ] Stripe Connect configured
- [ ] Stripe webhooks working
- [ ] Resend sending domain verified
- [x] `EMAIL_FROM` configured
- [x] Sentry configured
- [x] `/api/health` returns `"config": "ok"`
- [ ] Company/legal information configured
- [ ] Production database secured
- [ ] Google authentication working
- [ ] Email verification working
- [ ] Booking/payment flow tested
- [ ] Refund/cancellation flow tested
- [ ] Host payout flow tested
- [ ] Mobile and desktop QA completed

### Status and evidence (13 Oct 2026)

Production runs `27fdbc6` (release 12 Oct + #34), deployment `dpl_4iPbGdUars286CSCqSiKi8QkaX2L`, Ready; `/api/health` status/database/config all ok (13 Oct 00:11 UTC). Sentry receives Production errors (issue JAVASCRIPT-NEXTJS-2 below). `EMAIL_FROM` is set in Vercel Production (name checked, value not read).

| Item | Status | Evidence | Needs |
|---|---|---|---|
| Google sign-in | **Broken on Production - Google Cloud setting** | FYStay sends Google `redirect_uri=https://www.fystay.co.uk/api/auth/callback/google` (reproduced locally with Production's URL settings). The client was set up for `https://fystay.vercel.app` (docs/launch/social-sign-in.md); the one Google sign-up on Production was 7 Oct, before the site moved to www.fystay.co.uk on 11 Oct (`NEXTAUTH_URL` changed 11 Oct 09:03 UTC). | Owner: add the www callback and origin to the Google OAuth client; publish the consent screen. Then one test sign-in. |
| Admin access | Works by design; current admin is Google-only | One ADMIN account (a Gmail address, Google sign-in, no password), so it's locked out until Google sign-in is fixed - or it can set a password via "Forgot password". Admin URL: `https://www.fystay.co.uk/login` → `/admin`. Guests and hosts are refused (e2e `authorization.spec.ts`). The admin role can only be granted by `scripts/admin/grant-admin.ts`, which now requires a confirmed email. | Owner: register hello@fystay.co.uk and confirm it from that mailbox; then it can be made admin. |
| Identity verification | **Blocked - Stripe Identity not activated** | Sentry JAVASCRIPT-NEXTJS-2: Stripe answers `POST /api/account/identity/start` with "Your account is not set up to use Identity". The app shows "isn't available right now" and charges nothing. UI states (not started, loading, checking, verified, failed) exist; not yet tested against live Stripe. | Owner: activate Identity at dashboard.stripe.com/identity/application, then one test verification. |
| Calendar sync / channels | iCal import and export built; Channels page now honest | No direct Airbnb API (partner programme, invitation only). iCal import runs daily at 06:00 UTC (Vercel Hobby allows daily crons only) and is re-checked within 30 minutes before every FYStay booking. | Optional: Vercel Pro for more frequent syncs. Check the setup steps against a real Airbnb account. |
| Host payouts | Automated by Stripe Connect (destination charges) | Host's share is transferred when the guest pays and paid out on Stripe's schedule; refunds reverse the transfer and fee. Sandbox tests passed 11 Oct. Funds can reach the host before the stay; FYStay carries cancellations/chargebacks after payout (`losses_collector: application`). | Owner decision: payout timing (see master-checklist). Live: one controlled real booking, cancellation and payout. |
| Real email delivery | Unproven | Resend key and sender set; no real email seen arriving. | Owner test (password reset to a real inbox). |

## Final acceptance test

The final test must use a real-world, end-to-end scenario.

**Guest:** Discover → Sign up → Verify email → Search → Open listing → Save listing → Book → Pay → Receive confirmation → View booking → Manage booking.

**Host:** Sign up → Onboard → Create listing → Publish → Receive booking → Manage booking → Complete payout flow.

**Money:** at least one controlled real-money transaction must complete successfully. Verify:

Customer payment → FYStay booking → Stripe → Host booking → Host payout → Customer confirmation → Host confirmation

No step should require manual intervention.

## Development rule

Once the acceptance test passes, don't add major features before launch unless they are required for:

- Security
- Legal compliance
- Payment reliability
- Booking reliability
- Customer/host safety
- A genuine launch blocker

Feature requests are prioritised after real customers begin using FYStay.

## Current strategy

The October half-term launch is the priority.

The immediate objective is not to build the biggest possible platform. It is to build a **small, reliable, trustworthy marketplace that real customers can successfully book through**.

After launch, use real customer and host feedback to decide what to build next.
