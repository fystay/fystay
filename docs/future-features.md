# Future features (parked during Stage 2)

Stage 2 was about making the existing booking journey work properly, with
no new features. Ideas that came up during the audit but would have been
new features are listed here instead, so they aren't lost. Each one is
roughly sized and says why it was deferred.

## Guests

- **A clear "expired" state for unpaid reservations.** Today an abandoned
  checkout is stored as `CANCELLED` and hidden from My trips (see
  `isAbandonedReservation`). Giving it its own `EXPIRED` status would need
  a schema migration and is mainly useful for reporting. *Medium.*
- **A cancellation reason** chosen by the guest when they cancel, so hosts
  and FYStay can see why stays fall through. *Small, needs a migration.*
- **An email when a delayed payment fails.** Checkout is card-only, so
  Stripe confirms or declines straight away. If bank-transfer or other
  delayed payment methods are added later, the guest will need a "your
  payment didn't go through" email. *Small, only needed with new payment
  methods.*
- **Saved searches and price alerts** ("tell me when somewhere in Lytham
  drops under £100"). *Medium.*

## Hosts

- **A booking detail page for hosts**, with the guest's message, phone
  number, payout breakdown and a timeline. Today hosts see a one-line
  summary on the dashboard and the full conversation in the inbox.
  *Medium.*
- **Payout history in FYStay itself.** Today the host opens their Stripe
  Express dashboard for payout dates. A FYStay page listing each transfer
  would read Stripe's balance transactions. *Medium.*
- **Choosing a town from a list** on the listing form, rather than typing
  the city name freely, so every listing lands under the right Explore
  filter. *Small.*
- **Photo reordering by drag and drop** in the listing form (today the
  first photo you add is the cover). *Small.*

## Emails

- **Open and click tracking** on transactional emails (Resend supports
  it). Not set up: the cookie notice promises no tracking, so this would
  need a privacy policy update first. *Small.*

## Platform

- **Real Stripe test-mode run on Preview**: success, decline, abandon,
  delayed webhook, refresh, double-click and Back, run by hand against
  Stripe's hosted checkout page. The logic behind each case is covered by
  automated tests that don't need live Stripe (`booking-lifecycle`,
  `checkout`, `guest-booking`, and the webhook unit tests). Doing it on
  Preview needs a person at a browser with Preview access.
