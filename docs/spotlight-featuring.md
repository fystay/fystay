# Spotlight stays (paid featuring)

Hosts pay FYStay to feature a listing in **Spotlight stays**, the first listings
row on the homepage. Code: `src/lib/listingPromotions.ts` (rules),
`/api/host/promotions` (purchase), the Stripe webhook (activation),
`/host/promote` (host page), `/admin/promotions` (admin), and
`src/components/SpotlightStays.tsx` (homepage row).

## Rules

- **Plans:** 7 days £15, 14 days £25, 30 days £45 (`PROMOTION_PLANS`). Each
  placement snapshots its price, so changing a price never rewrites past ones.
- **Spots:** at most 8 listings at once (`SPOTLIGHT_SLOTS`). A host's own
  placements never count against them; buying again for a featured listing
  starts when its current placement ends.
- **Eligibility:** published, not suspended, and the host has finished Stripe
  payout setup - a guest who finds a featured listing must be able to book it.
- **Payment:** Stripe Checkout on FYStay's own account (not Connect), card only.
  `checkout.session.completed` activates it; `checkout.session.expired` closes
  an abandoned one. No cron: live/scheduled/finished come from the dates.
- **Disclosure:** every card in the row is labelled "Promoted" and the heading
  says hosts pay for the spots (UK rules on paid placement). Search results
  are not affected by Spotlight.
- **Ending early:** admins can end a live or scheduled placement at
  `/admin/promotions`. Refunds, if any, are made in the Stripe Dashboard.
- **Without a Stripe key** (local development, CI) a purchase activates
  immediately; a production deployment without a key refuses it.

## Release

Migration `20261005120000_add_listing_promotions` adds one table and one enum
(additive only). Run the production migration workflow for the release commit
before promoting it (see `docs/production-database-migrations.md`). The
homepage row tolerates a database that hasn't been migrated (it just doesn't
show), but `/host/promote` and `/admin/promotions` need the table.
