# Commission, smart pricing and payouts

Code:
- [`src/lib/pricingPolicy.ts`](../src/lib/pricingPolicy.ts): commission policies, the commission formula, fees and contribution.
- [`src/lib/marketDemand.ts`](../src/lib/marketDemand.ts): what FYStay's own bookings say about demand.
- [`src/lib/dynamicPricing.ts`](../src/lib/dynamicPricing.ts): demand assessment and the nightly-price engine.
- [`src/lib/stayQuote.ts`](../src/lib/stayQuote.ts): the one quote every flow uses, plus decision records.
- [`src/lib/smartPricingMode.ts`](../src/lib/smartPricingMode.ts): the switch.

**Status: built, disabled.**
- `SMART_PRICING_MODE` is unset, so it's `off`.
- Production is charged exactly what it is today: the host's own price and a fixed 10%.
- The production migration `20261014120000_smart_pricing_and_commission_policy` has **not** run.
- Every commercial figure below is **provisional** until the owner approves it.

## What other marketplaces do (research, Oct 2026)

There is no single industry-standard commission or algorithm. Published figures vary by platform, market, contract and year. Where they come from third parties, treat them as indicative.

**Airbnb**
- Moved most hosts to a host-only fee of about 15.5% during 2025, with no separate guest fee.
- The older split model was about 3% from the host plus about 14–16.5% from the guest.

**Booking.com**
- Commission is about 15% as a headline figure, quoted in a 10–25% range by market.
- The Preferred Partner programme adds about 3 points; Preferred Plus totals about 23%.
- Genius discounts are funded by the host.

**Vrbo**
- Historically 5% commission plus 3% payment processing.
- Expedia announced a move to a flat rate of about 12%, up to about 15%, including processing.

**Stripe (UK)**
- Standard UK cards: 1.5% + 20p.
- Premium UK cards: 1.9% + 20p.
- EEA cards: 2.5% + 20p.
- International cards: 3.25% + 20p, plus 2% for currency conversion.
- **Stripe doesn't return its processing fee on a refund.**

**What the established platforms have in common**
- A base rate.
- Programme or placement uplifts that the host chooses.
- Host-funded discounts that are shown separately.
- Processing costs either bundled into the commission or charged separately.
- Long-stay and length-of-stay pricing.
- Dynamic nightly pricing as an opt-in tool, with host-set minimum and maximum prices.

**What FYStay takes from this**
- Keep a base rate near today's 10%.
- Vary it only for reasons tied to FYStay's own costs or to data FYStay actually has.
- Bound it tightly.
- Disclose it before the host agrees.
- Keep payment processing as FYStay's cost, so the host sees one figure.

## How money moves

Verified in code, and unchanged by this work:

1. **The guest pays the stay's price and nothing on top.** There is no guest fee, and cleaning is part of the nightly rate.
2. **`POST /api/bookings` prices the stay on the server.** The browser never sends a price; it only sends the total it was shown, and the server refuses (409) if that has changed. The booking stores:
   - the rates and discounts;
   - FYStay's fee (`hostCommissionCents`);
   - the policy (`pricingPolicyVersion`);
   - the effective rate (`commissionRateBps`);
   - the price at the host's own rates (`basePriceSubtotalCents`, when smart pricing changed it);
   - the decision record (`priceDecisionId`).
3. **Checkout** (`/api/checkout`) charges the booking's stored total as a Stripe Connect destination charge.
   - The `application_fee_amount` is FYStay's fee **less** any referral credit or promo code. Those are FYStay's marketing cost.
   - The host's transfer is the rest. Discounts never reduce the host's payout.
4. **Stripe's processing fee is paid by FYStay** (the platform pays it on a destination charge).
   - Quotes and reports estimate it at 1.5% + 20p.
   - The actual fee is read back from Stripe after payment into `Booking.stripeProcessingFeeCents`.
   - That write only happens when the field is still empty, so a webhook retry can't change it.
5. **Refunds and cancellations**
   - The guest's refund is decided by the booking's cancellation terms. The commission doesn't change it.
   - Stripe reverses the host's transfer and FYStay's fee in the same proportion (`reverse_transfer` and `refund_application_fee`), using idempotency keys.
   - Stripe keeps its own processing fee, so a fully refunded booking costs FYStay that fee.
6. **Date changes** move FYStay's fee at the booking's own stored terms (`splitBookingChange`). Today's policy is never used.
   - Fixed-10% bookings (and every booking from before versions existed) move at 10%, exactly as before this PR.
   - Dynamic-policy bookings move at their **exact** stored ratio (fee ÷ accommodation), not a rate rounded to a basis point.
     - An extension's application fee is the fee on the new total at that ratio, less the fee already taken.
     - A shortened stay returns `round(refund × fee ÷ accommodation)` of the fee, the same proportional share Stripe's `refund_application_fee` returns.
7. **The webhook confirms a booking only if Stripe took exactly its stored total in GBP.**
   - It confirms under the availability lock.
   - A repeated delivery is a no-op: one confirmation and one set of emails.

## The commission formula

All amounts are integer pence and all rates are integer basis points (1000 bp = 10%).
- `A` is the accommodation after weekly, monthly or last-minute discounts.
- `B` is the same stay at the host's own rates.

```
rate = base + booking value + lead time + demand* + season* + market
       kept within [minRate, maxRate]
fee  = round(A × rate) + round(max(0, A − B) × upliftShare)        (never above A × maxRate)
fee  = max(fee, estimated card fee + minContribution)               (never above A × maxRate)
fee  = min(fee, A − host's minimum payout for the stay)             (never below A × minRate)
fee  = min(fee, A)
application fee = max(0, fee − FYStay-funded discounts)
host payout     = guest total − application fee
contribution    = application fee − Stripe fee (actual once known, otherwise the estimate)
```

\* Demand and season only count when their data is at **medium or high confidence**. Otherwise they add nothing.

### `dynamic-v1`: provisional figures and why each input exists

| Input | Provisional | Why |
|---|---|---|
| Base | 10% | Today's rate, so the shadow comparison is like-for-like. It's below Airbnb's about 15.5% and Booking.com's about 15%, and FYStay also pays card fees. |
| Booking value | +1.5 pts under £150; 0 to £600; −0.5 pts to £1,500; −1 pt above | Per-booking costs (Stripe's 20p, support, payment risk) are a bigger share of a small booking. Longer stays compete with mid-term rentals. |
| Lead time | +0.5 pts when booked 120+ days ahead | Cancellations are more likely far out, and Stripe keeps its fee on a refund. **Calibrate from FYStay's own cancellation rate by lead time.** |
| Demand | ±0.5 pts | FYStay's own booking pace in the town against its usual pace at the same lead time. Only used with enough data (see below). |
| Season | ±0.5 pts | Needs a year of FYStay bookings in the town, so it's inactive until then. |
| Market | −1 pt while the town has fewer than 5 live FYStay listings | A cold-start incentive while FYStay builds supply. Listing counts are FYStay's own data, never a guess. |
| Uplift share | 10% of any smart-pricing rise above the host's own price | FYStay's engine created that extra revenue. The host keeps 90% of it, after the base rate. |
| Cost floor | Estimated card fee + 50p | A booking should never cost FYStay money to take. |
| Bounds | 8%–15% | What the host agrees to. Even all the increases together stay below 15%. |
| Host minimum | Fee reduced, down to 8% at the lowest | The host's minimum payout comes before FYStay's rate. |

A change to any figure is a **new version**. Bookings keep the version they were priced under, and **hosts must agree again** (`Listing.smartPricingConsentPolicyVersion`). Until they do, they're charged the fixed 10%.

**`fixed-10-v1`** stays in use only for:
- bookings made before versions existed;
- hosts who haven't agreed to the dynamic policy;
- hotel room types;
- rollback.

## The nightly-price algorithm

Pure and deterministic: the same inputs always give the same price.

1. **Demand** (`marketDemand.ts`, `assessDemand`)
   - It only counts **paid FYStay bookings** (CONFIRMED or COMPLETED) for single-unit listings in the listing's town.
   - **Never counted:**
     - a listing's own full calendar (it can be full because the host blocked it or priced too low);
     - host blocks;
     - iCal imports;
     - pending or cancelled bookings;
     - competitor prices.
   - **Forward share:** the town's listing-nights for the stay's dates that are already booked.
   - **Usual pace:** over the last 180 days, the share of listing-nights that had already been booked this far ahead of the night.
   - **High demand:** forward share ≥ 1.5 × pace. **Low demand:** ≤ 0.5 × pace, and only within 14 days of check-in. Demand isn't read more than 60 days out.
   - **Confidence:**
     - **none** with fewer than 5 live listings or fewer than 10 bookings in 180 days;
     - **low** with no usual pace to compare with;
     - **high** at 20 or more listings and 50 or more bookings;
     - otherwise **medium**.
2. **Season:** the stay's month last year against the town's year. It needs 365 days of history and 10 or more bookings that month.
3. **Local events:** verified Ticketmaster events during the stay, ignored if the feed is more than 7 days old. `TICKETMASTER_API_KEY` isn't set in Production.
4. **Not used yet:** comparable prices, a conversion model, school holidays and listing views. The interfaces exist, but FYStay has no reliable data for them.
5. **The proposal:** each reliable signal is one 5% step, and the total is capped at ±15%. The host can choose a smaller cap.
6. **The choice:**
   - Every candidate is rounded to whole pounds and clamped to the host's minimum and maximum nightly price.
   - Candidates that pay the host less than their minimum payout per night (under the dynamic commission) are dropped.
   - The engine picks the candidate closest to the proposal. With a conversion model, it would pick the one with the highest expected contribution instead.
   - Without a validated conversion model, the price only moves in the direction the demand data points, and no further than it proposes. It is never raised just to meet the host's minimum.
   - The host's own price is judged with FYStay's fee already reduced for their minimum, so a high minimum alone never moves the price.
   - If the host's own price, with FYStay's fee cut as far as 8%, still doesn't pay the minimum, see "The host's minimum payout" below.
7. **When data is sparse** (true in every FYStay town today), every signal is `none` and the price is the host's own: the documented baseline. The decision records why.

## The host's minimum payout

The host sets it per night. It is enforced **per stay**: payout ≥ minimum × nights. On a stay mixing weekday and weekend nights, it is the average per night that is guaranteed, not each night.

**1. Prevented when it is set.** Both the smart-pricing settings and the listing's own price and discount edits are refused if the minimum can't be met on every stay (`minimumPayoutError`). The highest allowed minimum is:

```
floor(nightly price × (1 − host's largest own discount) × (1 − 8%) − 1p)
```

- The largest discount is whichever is biggest of the weekly, monthly and last-minute discounts, assuming the worst case.
- The 1p covers rounding: the discount and the fee each round once per stay.
- A test covers prices from £9.99 to £543.21, discounts of 0–33% and 1–60 nights, and shows every stay pays it.
- Example: £100 a night with a 20% weekly discount allows at most £73.59 a night.

**2. At booking (a safety net).** FYStay's fee is cut, down to 8% at most, so the host gets the minimum.
- If that isn't enough, the host's own stay discount is reduced a whole percent at a time until the stay pays it. For example, 20% becomes 13%, and the guest sees "Weekly discount (13%)" and is charged exactly that.
- The preview and the booking use the same quote, so they always agree.
- The decision records "Your 20% stay discount was limited to 13%", and the Edit listing page warns the host about the conflict.

**3. Explicit outcome when it can't be met.** If even the undiscounted price can't pay the minimum (only possible with data saved before these checks), the result is marked `constrained`:
- the host's own price is charged at 8%;
- the decision says so ("can't be met for this stay … raise your nightly price or lower your minimum");
- it is logged as `smart_pricing_constrained`.

The engine never raises the guest's price to meet the minimum.

**4. Date changes.** Each dynamic booking stores the minimum it protected (`Booking.minHostPayoutPerNightCents`).
- The change quote limits the host's discount the same way.
- A change that would still pay the host less is refused (`changeBreaksMinimumPayout`) when it is requested and again when it is approved. An example is dropping a weekend night from a stay with a high fee ratio.
  - The guest sees "can't be requested as a change … under the host's pricing", which never states the figure.
  - The host is told it is below their minimum.
- The guest can cancel under the policy and book the new dates instead.
- The host's minimum is never sent to the guest's browser: guest booking APIs strip it (`guestBookingView`), and the change dialog defers the exact price to the server.

**5. Cancellations are not covered.** The published cancellation policy decides what the host keeps, and a refund reduces their payout in the same proportion as the guest's refund.

**Currency.** Everything is in GBP pence. Checkout charges GBP only, and the webhook refuses any other currency. No conversion is involved.

## Reconciliation with Stripe

`src/lib/financialFlow.test.ts` simulates 3,000 random dynamic bookings: smart pricing, checkout with and without promos, up to two date changes, and part-cancellations. It compares FYStay's books with what Stripe moves on a destination charge.

**Exact to the penny:**
- checkout (the host's transfer is always accommodation − commission; promos come only out of FYStay's fee);
- every extension payment;
- a booking's first refund change;
- a part-cancellation with no refund before it;
- the guest's total paid, at every step;
- the host's minimum, never broken.

**Up to 1p per refund:** a booking's later refunds.
- Stripe works out each refund's fee share at the ratio of the payment it hits, newest payment first.
- The books carry one ratio for the whole booking.
- Making these exact needs a per-payment refund ledger, or reading Stripe's actual fee refunds back. That is a follow-up.

**Assumption, not verified against live Stripe:** Stripe rounds its proportional fee refund to the nearest penny. Stripe documents the refund as proportional but not how it rounds.

**Admin reporting** nets refunds off gross booking value and platform revenue in the same proportion. The booking page shows FYStay's contribution after refunds and Stripe's fee. Stripe's fee is never returned.

## A worked example

| | Fixed 10% (today) | Dynamic, smart price applied |
|---|---|---|
| Stay | 3 nights × £120 | 3 nights × £126 |
| Accommodation | £360.00 | £378.00 |
| FYStay promo code (FYStay-funded) | −£10.00 | −£10.00 |
| **Guest pays** | **£350.00** | **£368.00** |
| FYStay commission | £36.00 (10%) | £41.49 (10.98%) |
| Application fee (commission − promo) | £26.00 | £31.49 |
| **Host receives** | **£324.00** | **£336.51** |
| Stripe fee (estimate, FYStay's cost) | £5.45 | £5.72 |
| FYStay contribution | £20.55 | £25.77 |

Assumptions for the dynamic column:
- The stay is in Blackpool, 10 days ahead.
- The town has 12 live listings and 40 bookings in the last 180 days (medium confidence).
- 60% of the town's nights for those dates are booked, against a usual 35%.
- The host set a £100 minimum payout and a £140 maximum price.

How the dynamic commission is made up:
- 10% base, +0.5 points for high demand: 10.5% of £378 = £39.69.
- Plus 10% of the £18 rise: £1.80.
- Total: £41.49.

The host's extra £12.51 is the £18 rise less the commission on it. These figures are computed by the code (`dynamicPricing.test.ts` covers the same path).

## What hosts and guests see

**Hosts** (Edit listing → Smart pricing):
- the commission range, plus every rule listed from the policy's own figures (`describeCommissionPolicy`);
- a worked example at their own price;
- a statement that card fees and FYStay's promo codes or credit are FYStay's cost;
- consent to that policy version;
- their limits: minimum payout (required), target, minimum and maximum price, and largest change.

Their booking page shows that booking's own rate.

**Guests:**
- They see one total with nothing added.
- Smart-priced stays carry the note "The host's price for these dates reflects demand around them". Search cards say "price varies by date".
- Reserve waits for the server's price, and a changed price is refused (409) rather than charged.

**Admins** (booking page):
- the policy and rate;
- the Stripe fee, actual or estimated;
- FYStay's contribution.

## Audit trail

Every new single-unit booking made while the mode is `shadow` or `on` writes a `PriceDecision` row, linked from the booking. It holds:
- **the proposal:** policy, price, commission rate and fee, host payout, and contribution;
- **the charge:** policy, accommodation, fee and host payout;
- **the data confidence;**
- **the inputs (JSON):** the demand assessment with its sample sizes, every signal with its source, time and confidence, both commission calculations line by line, the constraints and the candidates;
- **a plain-English explanation.**

The booking route also logs `pricing_shadow_comparison` with charged against proposed. Availability previews never write.

## Rollout: database first, then staged

1. **Review and approve** this PR's code and the figures marked provisional. Nothing merges before that.
2. **Production migration first.** Run the "Production database migration" workflow for this PR's commit (reviewer approval required). It's additive only: nullable columns, a new table and RLS on it.
3. **Merge or deploy with `SMART_PRICING_MODE` unset (`off`).** Nothing changes for anyone.
4. **Shadow (2–4 weeks or 30+ bookings):** set `SMART_PRICING_MODE=shadow`. Guests and hosts are charged exactly as today.
   - Compare `chargedPlatformFeeCents` against `platformFeeCents` per booking.
   - Check the distribution of proposed rates, how often each component fires, and `dataConfidence`.
   - Check `smart_pricing_failed` and `smart_pricing_constrained` logs.
5. **Pilot:** set `on`. Then invite a few hosts, starting with the owner's own listing, to opt in on the Edit listing page. They see the terms and agree; no one is opted in automatically.
   - Each week, compare their conversion, guest totals, host payouts and contribution with shadow-only listings.
   - Check for constrained decisions and support contacts.
6. **Calibrate** the figures from that data and publish them as `dynamic-v2`. Hosts must agree again.

**Monitoring:**
- `PriceDecision` by `mode`, `outcome` and `dataConfidence`;
- the Sentry and Vercel logs named above;
- the admin booking page's contribution figure;
- Stripe's actual fees against the estimate.

**Rollback:** set `SMART_PRICING_MODE=off` (or remove it) and redeploy.
- New quotes go back to the hosts' own prices at the fixed 10%.
- Bookings already made keep their stored amounts and rates. Refunds and date changes use each booking's own figures.
- Hosts' settings and consent are kept.
- To stop one listing, the host turns it off.

## Decisions needed (owner)

1. **Commission figures:** base, bands, lead-time, demand, season and market adjustments, uplift share, minimum contribution, and the 8–15% bounds. Approve or change them before the pilot.
2. **Whether the dynamic commission should ever be the default** for new hosts, which would be disclosed at sign-up, or stay opt-in only.
3. **Pricing limits:** the ±15% cap and 5% step, and whether hosts may choose more than 15%.
4. **Host consent wording, and the Terms.** A solicitor should review it before `on` (see below).
5. **Pilot hosts and length,** and the success measures, for example host payout, conversion and complaints.
6. **Ticketmaster:** whether to set `TICKETMASTER_API_KEY`, which makes the events signal live.

## Disclosures

Every fixed-10% claim was checked.

**General copy now uses `hostCommissionText(mode)`.** It reads "10%" in `off` and `shadow`, where only 10% is ever charged, and "10% (8%-15%, worked out per booking, on listings where you've turned on smart pricing)" in `on`. It is used on:
- the host landing page;
- the host guide;
- the dashboard;
- the listings, earnings and payouts pages.

**Per-booking copy uses the booking's own rate:**
- the host's "New booking" email ("FYStay's 11.5% commission for this booking");
- the host booking page.

**The listing form** adds the 8–15% range for a host with smart pricing on.

**Not changed, needs a solicitor before `on`:**
- **`/legal/terms`** says "FYStay keeps a commission of 10%". That is accurate while dynamic commission is off. It needs the clause below before any host is charged under it.
- **`docs/launch/legal-drafts.md`** has the same fixed-10% wording.
- **The consent text in the smart-pricing panel.** It includes the policy version, the range, every rule and the payout limits.
- **The guest-facing note** "The host's price for these dates reflects demand around them", to check against the CMA's dynamic- and drip-pricing guidance.

## Wording for legal review (not published)

The Terms (`/legal/terms`) still describe the fixed commission, which is what's charged. Before `SMART_PRICING_MODE=on`, a solicitor should review a host-terms clause along these lines:

> If you turn on smart pricing for a listing, you authorise FYStay to set that listing's nightly price for particular dates, within the minimum and maximum prices and the minimum payout you set, by up to the percentage you allow. FYStay's commission on that listing's bookings is then worked out per booking under the commission policy shown to you when you agreed (version [x]), between [8]% and [15]% of what the guest pays for the stay. You can turn it off at any time; bookings already made keep their price and commission. Card processing fees and FYStay's own promotions are paid by FYStay.

Guest-facing wording should be reviewed against the CMA's guidance on dynamic and drip pricing.
