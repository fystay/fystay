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
- Guests pay the host's price and nothing on top: no service fee and no
  cleaning fee (hosts include cleaning in their nightly rate). Decided by
  the owner on 11 Oct 2026.
- At payment, Stripe moves the stay **less FYStay's 10% commission** to the
  host's Stripe account and FYStay keeps the **commission (10% of the stay
  after any length-of-stay discount, `Booking.hostCommissionCents`)**, less
  any promo code or referral credit (those come out of FYStay's commission,
  never the host's share).
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

**Launch rule (owner decision, 11 Oct 2026): no refunding date change on a
discounted booking.** A booking that used a promo code or referral credit
can't be moved to a shorter or cheaper stay; the guest cancels under its
policy and books again. Enforced when the guest asks
(`POST /api/bookings/[id]/change-requests`) and again, under the listing
lock, when the host approves (`.../respond`), so a request made before the
rule can't refund either. Same-price and longer changes are unaffected.
Rule: `isRefundChangeOnDiscountedBooking` in `src/lib/changeRequests.ts`.

### Deferred: shortened-stay refunds (post-launch improvement)

Why the rule exists. A date-change refund uses `reverse_transfer` and
`refund_application_fee`, which Stripe applies in proportion to the refund
across the whole *discounted* payment. On a discounted booking that passes
part of FYStay's promo cost to the host: 3 nights at £100 with a £20 promo,
shortened to 1 night, leaves the host £77.14 instead of 90% of £100 (£90).
The unused helper `refundChangeDifference` is not a fix as it stands: it
asks Stripe to refund more application fee than was collected (£20 against
£10), which Stripe refuses after the guest refund and transfer reversal
have already gone through.

What a proper workflow needs, all verified in the Stripe sandbox first:

- Refund the guest without the proportional flags, then reverse exactly the
  host's share (90% of the reduction) from the charge's transfer, so FYStay
  bears its own promo or credit.
- One idempotent, resumable job per change: each step (refund, reversal)
  recorded before and after, retried from where it stopped, with an ops
  alert if a later step can't complete. Never undo the date change once
  money has moved.
- Bookings with several payments: split the refund and the reversal across
  the payments' transfers, each capped by what that transfer has left.
- Reconciliation: FYStay's records (`hostCommissionCents`) are the truth,
  because Stripe's application fee object keeps its original amount.
- Later cancellations: check how Stripe's proportional reversal behaves on
  a charge already partly refunded this way (a full refund reverses the
  rest exactly; a partial one may not), and use the same exact method there
  if needed.
- Then lift the launch rule and show the host's earnings as accommodation
  less commission, matching what Stripe paid.

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
3. ~~**Fee model.**~~ Decided 11 Oct 2026: 10% host commission, no guest
   service fee, no cleaning fee; FYStay absorbs Stripe's fees and
   promo/credit discounts. Bookings made before keep their service fee.
4. **VAT** on the commission (accountant). The code has a tax line ready, at 0.
5. **Billing** later, if wanted: e.g. a Spotlight subscription or a host
   plan, as Stripe Billing subscriptions on the host's FYStay customer.
