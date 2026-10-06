# Stripe at FYStay: architecture and open decisions

Written 6 October 2026, after an inspection of the code and a run of
Stripe's own implementation planner (which recommended this architecture
for FYStay's answers). Setup steps are in
[stripe-and-email-setup.md](stripe-and-email-setup.md).

## What's built

| Stripe product | Status | Used for |
|---|---|---|
| **Payments (Checkout, Stripe-hosted)** | Built | Booking payments, paid date changes, trip extras, security-deposit holds, Spotlight purchases |
| **Connect (marketplace)** | Built | Hosts onboard with Stripe; each booking payment goes to the host's Stripe account minus FYStay's fee |
| **Billing (subscriptions)** | **Not built, deliberately** | Nothing at FYStay is recurring today (Spotlight is a one-off purchase) |

### Why hosted Checkout

FYStay already shows the whole booking on its own checkout page (stay, dates,
guests, nights, the price broken down, cancellation policy) before the guest
presses Pay. Stripe's hosted page then only takes the card. It handles 3D
Secure, Apple Pay and Google Pay (when switched on in Stripe), card errors
and retries itself, and keeps card details off FYStay entirely (lowest PCI
burden). The planner's default for this setup.

### How a booking is paid

1. The guest picks dates and guests. **The server** works out the price from
   the listing in the database (`src/lib/pricing.ts`); the browser can't send
   a price (`POST /api/bookings` only accepts listing, dates, guests and a
   promo code).
2. Checkout (`POST /api/checkout`) checks the booking is the signed-in
   guest's, still pending and still available, then creates a Stripe Checkout
   Session from the stored amounts, under the guest's own Stripe customer.
3. Only Stripe's **signed** `checkout.session.completed` webhook confirms the
   booking, and only if Stripe says it's paid **and** the amount and currency
   match the booking's stored total. The "thank you" page shows
   "Processing your payment…" until then; arriving there proves nothing.
4. Confirmation emails go once, however many times Stripe delivers the event.

### Money movement (Connect, destination charges)

- FYStay is the merchant of record (the guest's statement shows FYStay once the statement descriptor is set in Stripe).
- At payment, Stripe moves the **stay + cleaning fee** to the host's Stripe
  account and FYStay keeps the **guest service fee (10% of the stay after
  any length-of-stay discount)**, less any promo code or referral credit
  (those come out of FYStay's fee, never the host's).
- FYStay pays Stripe's processing fees out of its share.
- FYStay is liable for losses (refunds or chargebacks a host can't cover).
- Hosts are Stripe "recipient" accounts (Accounts v2), UK, Express dashboard,
  onboarded on Stripe's own pages (no FYStay-built identity checks).

### Payment states

`Booking.status` (PENDING, CONFIRMED, CANCELLED, COMPLETED) and
`Booking.paymentStatus` (UNPAID, PAID, PARTIALLY_REFUNDED, REFUNDED). With
hosted Checkout, "processing", "failed", "requires authentication" and
"cancelled" all happen on Stripe's page; FYStay's booking stays PENDING/UNPAID
until a verified payment arrives, and an abandoned payment page expires after
31 minutes and frees the dates. Separate failed/processing states would only
duplicate what Stripe already tracks, so they're not stored.

### Refunds

The server works out every refund from the listing's cancellation policy
(`src/lib/cancellationPolicy.ts`); the browser never sends an amount. A
cancellation is claimed in the database before any money moves, so two at
once can't both refund, and each Stripe refund carries an idempotency key.
If Stripe refuses a refund, the booking is put back as it was. Each refund
takes back the same proportion from the host's payout and from FYStay's fee.

Webhook events handled: `checkout.session.completed`, `.async_payment_succeeded`,
`.async_payment_failed`, `.expired`; `charge.dispute.created/updated/closed`;
`charge.refunded` and `refund.failed` (ops alerts, once each);
`account.updated` (Connect); `identity.verification_session.*`.

## Changes on 6 October

- Double-refund race fixed (atomic claim, idempotency keys, revert on failure).
- Webhook checks the amount and currency paid against the booking total.
- One Stripe Customer per FYStay user, created once and reused; deleted with
  the account.
- Ops alerts for refunds made in the Stripe Dashboard and for failed refunds.
- Admin booking page: FYStay's fee, the host's share, a link to the payment
  in Stripe.

## Decisions for the owner (not built until decided)

1. **When hosts get paid.** Today: as soon as the guest pays (destination
   charges), weeks or months before the stay. Airbnb-style alternative: FYStay
   holds the money and pays the host about 24 hours after check-in (Stripe
   "separate charges and transfers"). Holding protects guests and FYStay if a
   host cancels or the place isn't as described, since FYStay carries the
   losses; it means a bigger change to payments and refunds.
2. **Who pays back what on a refund.** Today a refund takes the same share
   from the host and from FYStay's fee. Alternatives: FYStay keeps its
   service fee on guest cancellations, or the host bears the whole refund.
3. **Fee model.** Today: 10% guest service fee on top, nothing taken from the
   host, FYStay absorbs Stripe's fees and promo/credit discounts. Confirm, or
   add a host commission.
4. **VAT** on the service fee (accountant). The code has a tax line ready, at 0.
5. **Billing** later, if wanted: e.g. a Spotlight subscription or a host
   plan, as Stripe Billing subscriptions on the host's FYStay customer.
