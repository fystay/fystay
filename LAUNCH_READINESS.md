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
- [ ] `EMAIL_FROM` configured
- [ ] Sentry configured
- [ ] `/api/health` returns `"config": "ok"`
- [ ] Company/legal information configured
- [ ] Production database secured
- [ ] Google authentication working
- [ ] Email verification working
- [ ] Booking/payment flow tested
- [ ] Refund/cancellation flow tested
- [ ] Host payout flow tested
- [ ] Mobile and desktop QA completed

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
