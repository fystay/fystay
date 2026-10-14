# Commission policy and smart pricing

Code: [`src/lib/pricingPolicy.ts`](../src/lib/pricingPolicy.ts) (policies, fees, contribution),
[`src/lib/dynamicPricing.ts`](../src/lib/dynamicPricing.ts) (the pricing engine),
[`src/lib/stayQuote.ts`](../src/lib/stayQuote.ts) (the one quote every flow uses),
[`src/lib/smartPricingMode.ts`](../src/lib/smartPricingMode.ts) (the switch).

## How money moves

Unchanged by this work, and verified in the code:

1. The guest pays the stay's price and nothing on top: no guest fee, and
   cleaning is part of the nightly rate.
2. `POST /api/bookings` prices the stay **on the server**. The browser never
   sends a price. The booking stores:
   - the rates and discounts;
   - FYStay's fee (`hostCommissionCents`);
   - the policy (`pricingPolicyVersion`) and the effective rate (`commissionRateBps`).
3. Checkout charges the booking's stored total as a Stripe Connect
   destination charge.
   - The application fee is FYStay's fee **less** any referral credit or
     promo code. Those are FYStay's marketing cost and never reduce the
     host's payout.
   - The host's transfer is the rest of the charge.
4. **Stripe's processing fee is paid by FYStay** (the platform, on a
   destination charge). It's estimated in quotes (1.5% + 20p, Stripe's
   standard UK card rate). The actual fee is read back from Stripe after
   payment into `Booking.stripeProcessingFeeCents`.
5. **Refunds:**
   - A cancellation reverses the host's transfer and FYStay's fee in
     proportion, at any rate (Stripe `reverse_transfer` + `refund_application_fee`).
   - A date change moves FYStay's fee at **the booking's own stored rate**,
     never today's.
6. **The webhook confirms a booking only if Stripe took exactly its stored
   total in GBP.** A repeated delivery is a no-op.

## The formula

For a stay with accommodation `A` (after weekly/monthly/last-minute
discounts) and `B` = what it would cost at the host's own rates:

```
platform fee  = round(A × baseRate) + round(max(0, A − B) × upliftShare)
                kept within [A × minRate, A × maxRate] and never above A
application fee = max(0, platform fee − FYStay-funded discounts)
host payout     = guest total − application fee
contribution    = application fee − Stripe processing fee (estimate until actual is known)
```

All money is in integer pence. Rates are integer basis points (1000 = 10%).
Rounding is to the nearest penny, once per component. Smart-priced nightly
rates are rounded to whole pounds before any of this.

## Policies

| Version | Used for | baseRate | upliftShare | min-max | Status |
|---|---|---|---|---|---|
| `fixed-10-v1` | Every listing by default, every hotel room type, and every booking made before versions existed (`pricingPolicyVersion` null) | 10% | 0 | 10-10% | **Live**: today's commission, and the rollback |
| `smart-v1` | Stays priced by smart pricing | 10% | **0** | 10-20% | Built. Charges exactly 10% until a schedule is approved |

**Business decisions needed before any rate changes:**
- `smart-v1`'s `upliftShareBps`: the share of a price rise FYStay keeps.
- Its `maxRateBps`.
- Whether `baseRateBps` should ever differ from 10%.

A new figure means a **new version**. Never edit one in use: bookings keep
the version they were priced under.

## Smart pricing

**Off unless both:**
1. `SMART_PRICING_MODE` is set on the server (`off` by default; `shadow` or
   `on`); and
2. the listing's host turned it on in *Edit listing → Smart pricing*, agreed
   to it (the time is recorded in `smartPricingConsentAt`), and set a
   minimum payout.

Only the host can change these settings, not an admin
(`PUT /api/listings/[id]/smart-pricing`).

| Mode | Guests are charged | Recorded |
|---|---|---|
| `off` | The host's own price | Nothing |
| `shadow` | The host's own price | The smart price, as a `PriceDecision` (`mode: shadow`) when a booking is made |
| `on`, host chose "change prices automatically" | The smart price | `PriceDecision` (`mode: applied`), linked from the booking |
| `on`, host wants to approve changes | The host's own price | `PriceDecision` (`mode: suggested`) |

**What the engine uses today.** These are the only signals FYStay actually
has:
- **Occupancy:** how many nights on the listing's own calendar are booked or
  blocked in the 14 days either side of the stay.
  - 70% or more: up 5%.
  - 20% or less, within 14 days of check-in: down 5%.
- **Local events:** verified events in the listing's town during the stay,
  from Ticketmaster (`LocalEvent`).
  - Ignored if the feed is more than 7 days old.
  - `TICKETMASTER_API_KEY` isn't set in Production, so this is inactive there.
- Each signal is recorded with its source, time and confidence.

**Not available yet (interfaces exist, no data):**
- comparable prices;
- booking-conversion estimates (`ConversionModel`; with one, the engine
  maximises expected contribution = probability × contribution);
- school and bank holidays;
- listing views.

Until then the engine follows the rules above and makes no claim to predict
demand.

**Limits:**
- 5% steps, at most ±15% (the host can set less).
- Never outside the host's minimum and maximum nightly price.
- Never below their minimum payout per night.
- If no price meets the minimum, the host's own price is charged and the
  decision is marked `constrained`.
- A target payout is reported as met or unreachable; it is never invented.
- The engine is deterministic: the same inputs always give the same price.

**Shown to guests:**
- The listing page quotes the server's price. "Reserve" waits for it, and
  the booking is refused (409) if the price changed since it was shown.
- Search cards for smart-priced stays say "price varies by date" instead of
  a computed total.

**Not covered yet:** hotel room types (always `fixed-10-v1`).

## Rollout

1. Run the production migration `20261014120000_smart_pricing_and_commission_policy`
   through the approved workflow (additive only).
2. Deploy with `SMART_PRICING_MODE` unset (`off`). Nothing changes.
3. Set `shadow`. Hosts can opt in; guests still pay the hosts' own prices.
   Compare the `PriceDecision` rows.
4. Set `on` for a trial with the owner's own listing first.

**Rollback:** set `SMART_PRICING_MODE=off` (or remove it) and redeploy.
- New quotes go back to the hosts' own prices at the fixed 10%.
- Bookings already made keep their stored amounts. Refunds and date changes
  use each booking's own stored rate.
- Hosts' settings are kept, so turning it back on needs nothing re-entered.

## Wording for legal review (not published)

The Terms (`/legal/terms`) still describe the fixed commission, which is
what's charged. Before `SMART_PRICING_MODE=on`, a solicitor should review a
host-terms clause along these lines:

> If you turn on smart pricing for a listing, you authorise FYStay to set
> that listing's nightly price for particular dates, within the minimum and
> maximum prices and the minimum payout you set, by up to the percentage you
> allow. You can turn it off at any time; bookings already made keep their
> price. FYStay's commission on a smart-priced stay is [rate] of the price the
> guest pays [plus [share] of any amount above your own price]. Card
> processing fees are paid by FYStay.

Guest-facing wording ("the host's price for these dates reflects demand
around them") should be reviewed against the CMA's guidance on dynamic and
drip pricing.
