# Pre-production audit (7 October 2026)

The final check of branch `claude/host-platform-upgrade` before it goes live:
the host journey as a brand-new host, empty/loading/error states, perceived
performance, security, booking and payment integrity, Stripe, the
migration, mobile and accessibility. Companion to
[host-platform-audit.md](host-platform-audit.md).

## Verdict

**Ready to deploy once the one migration has run** (steps at the end). No
blocking issues remain in the code. Two things outside the code stop real
money moving - Stripe live activation and live webhooks - which only matter
once you take real bookings.

## Results

| Check | Result |
|---|---|
| Unit tests | **1,329 / 1,329 passing** (131 files) |
| Browser tests (production build) | **115 / 115 passing** |
| Typecheck / lint | Clean (0 errors) |
| Mobile (390px) | Every hosting page, the listing form, homepage, search, login: **no sideways scrolling** |
| Accessibility (axe, WCAG 2.1 AA) | **0 issues** on all 12 hosting pages, desktop and phone; homepage/search/login 0 |
| Layout shift (CLS) | **0** on every hosting page, search, listing, bookings, inbox; homepage 0.017 (was 0.04-0.19) |
| Speed | Server response 23-117ms; main content visible 110-310ms on hosting pages |
| Security (host isolation) | **No critical or high findings**; 1 medium + 2 low fixed |
| Money integrity | 3 high + 3 medium + 3 low found by a second review, **all fixed and tested** |
| Migration | 1 additive migration, safe on existing data |

## 1. New-host journey (sign up → dashboard)

Walked as a brand-new host, desktop and phone. What was confusing, and the fix:

| Found | Fix |
|---|---|
| New host's Today showed a checklist *and* a second "Create a listing" panel | One welcome: "Let's get your first place live", three numbered steps, one primary button |
| With a listing but no bookings, Today was empty charts, £0 tiles and empty Great Host bars | "Get ready for your first guest" checklist from real data (payouts, live, complete, calendar sync) beside the action list |
| Bookings, Calendar, Listings, Earnings looked broken when empty (blank page, a lone date row, a grid of £0 with "−£0") | Each has an empty state saying what will appear and the one next step; Earnings explains how hosts get paid |
| Listing said "Live" though guests couldn't book until payouts were set up | Says "Not bookable yet" until then |
| A just-created listing showed "0% complete" | Basics now count; the checklist shows what's left |
| Hosts landed on the guest homepage after logging in (password, Google, Apple) | Hosts land on their dashboard |
| A guest with an approved-but-unpaid date change had no way to say no | "Keep my original dates" |

Would a host leave after 10 minutes? The remaining reasons a host might are
product gaps, not polish: no automated guest messages, no real-time Airbnb /
Booking.com sync (iCal only), no per-date pricing, and hosts can't cancel a
booking themselves. These are on the roadmap.

## 2. Perceived performance

Measured on a production build (desktop, and a phone on a throttled 300ms /
200KB/s connection). Classification: **A** real performance, **B** fast but
abrupt, **C** doesn't say what happened, **D** fine as it is.

| Where | Before | Class | Change | After |
|---|---|---|---|---|
| Login | Button stopped spinning the moment the password was accepted, then the page jumped | B/C | Button stays busy: "Signed in - opening your dashboard…" until the next page is on screen | Clear hand-off, no extra time |
| Login destination (hosts) | Homepage | C | Dashboard (password and Google/Apple) | — |
| Sign-up | Same early spinner reset | B | Stays busy through the hand-off | — |
| Log out | No feedback during the server round trip | C | "Logging out…" | — |
| Switching hosting tabs | 7 of 9 hosting pages had no loading shell: the old page just sat there | B | A loading shell shaped like each page (prefetched, shown instantly) + a pending bar on the tapped tab on slow connections | Shell at ~100ms, content 300-450ms on the throttled phone |
| Every page, first visit | Cookie notice inserted above the page after load pushed everything down 57px (130px on phones) | B | Floating card that doesn't move the page | CLS 0.04 → 0 |
| Today / Listings / Calendar | Footer jumped ~700px when content replaced the loading shell | B | Shells are a full screen tall | CLS 0.19 / 0.14 / 0.10 → 0 |
| Page entrance | A 220ms fade I added first delayed "content visible" by ~500ms | A (self-inflicted) | Replaced by a 4px, 180ms settle with no fade | 650ms → 110-310ms |
| Network failures | Several buttons spun forever if the connection dropped | C | "Couldn't reach FYStay - check your connection" and the button resets (login, sign-up, listing save, accept/decline, date change, deposit, Live/Hidden, delete) | — |
| Accept / decline / approve | No feedback while working; could be pressed twice | C | Spinner on the pressed button, both disabled | — |
| Server response, auth flashes | 23-117ms; header and permissions resolved on the server, so no logged-out flash or wrong page | D | Unchanged | — |
| Booking reserve, checkout, confirmation | Already had busy buttons and a "confirming payment" screen | D | Unchanged | — |

Motion system (deliberately small): micro-interactions use the existing
150-200ms colour/opacity transitions; page arrival is a 180ms 4px settle;
loading uses shimmer shells shaped like the page; every motion is off
under reduced-motion. No artificial delays anywhere.

## 3. Security

Independent review of every route and page that takes an object id. **Host
A cannot read or change Host B's listings, bookings, earnings, guests,
conversations, deposits, calendars, PMS or Stripe data** - every query on
the hosting pages is scoped by the signed-in host; another host's booking
returns 404; listing filters are whitelisted; Stripe balance/dashboard only
use the session's own account; all 22 admin APIs and 15 admin pages check
ADMIN; crons and the demo seed use constant-time secrets; callback URLs
are sanitised; role/suspension/session version are re-checked on every
request.

Fixed: page titles of listing edit/calendar/reviews and conversations were
looked up before the ownership check (named someone else's listing to
anyone holding its link) - now owner-scoped. iCal feed token compared in
constant time. New conversations can't be opened on hidden/suspended
listings by guests who never booked them.

Open (low): the iCal token is a cuid (not 32 random bytes) and can't be
rotated; a host could set another host's PMS property id (unreachable
while PMS webhooks fail closed). Row-level security on most tables comes
from Supabase's auto-enable, not from a repo migration.

## 4. Booking and payment integrity

Re-tested by a second review. Fixed in this pass, each with tests:

- **High:** a redelivered Stripe "payment completed" for a booking that was
  paid, confirmed and then cancelled under a strict/partial policy refunded
  the money the policy kept → now ignored.
- **High:** a hotel could be booked without a room type (outside room
  inventory, at the cheapest rate) → refused.
- **High:** two approved date changes could both be paid and stack →
  one change at a time; a payment for a change that no longer matches the
  booking is refunded.
- **Medium:** a change paid in one tab after another tab found the dates
  taken was kept but not applied → refunded; open payment page closed.
- **Medium:** paid trip extras weren't refunded when a booking was
  cancelled → refunded if not yet sent to the provider (ops alert if they
  were); fulfilment refuses cancelled bookings.
- **Medium:** a deposit transfer could be duplicated after Stripe's 24h
  idempotency window → existing transfer looked up first.
- **Low:** deposit hold authorised mid-cancellation left on the card;
  shorter-stay refunds failed after an earlier paid change; cancellation
  rate counted refused payments → all fixed.

Verified: double booking (every date writer takes the per-listing lock and
re-checks inside it), cancellation during payment (late payment refunded,
credit/promo returned once), duplicate cancellations and refunds (claimed
atomically, keyed per payment), earnings for confirmed, completed,
cancelled, refunded, changed and discounted bookings (guest paid = host
share + FYStay fee + refunds).

Known, not fixed (low): a Stripe retry after a failure that happened after
confirmation doesn't resend the confirmation email.

## 5. Stripe - what works in test vs what production needs

Built and tested: Checkout, Connect destination charges (host gets nightly
rate + cleaning; FYStay keeps the guest service fee and pays card fees),
refunds (proportional, reversing the host transfer and FYStay's fee),
disputes (alerts; FYStay bears losses), deposits (hold, claim → transfer
to host, release), webhooks (signed, amount-checked, idempotent), host
Stripe balance shown live.

**Owner actions before real money moves:**
1. **Activate the live Stripe account** (business details, bank account,
   terms) - charges and payouts are off.
2. **Enable Connect in live mode** (recipient accounts, UK).
3. **Live keys in Vercel Production**: `STRIPE_SECRET_KEY`,
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `STRIPE_CONNECT_WEBHOOK_SECRET` (none set today).
4. **Two live webhook endpoints** to `https://<live domain>/api/webhooks/stripe`:
   - Account events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`,
     `charge.dispute.created`, `charge.dispute.updated`,
     `charge.dispute.closed`, `charge.refunded`, `refund.failed`,
     `identity.verification_session.verified`,
     `identity.verification_session.requires_input`.
   - Connected accounts: `account.updated`.
   (The test-mode endpoint was missing the two identity events - added on
   7 Oct, so hosts' "Identity verified" badge updates.)
5. Preview test run still needs the Preview database settings and the
   Vercel protection-bypass on the test webhook URLs.

## 6. The production migration

One migration since what's live: `20261007090000_add_deposit_transfer`.

```sql
ALTER TABLE "Booking" ADD COLUMN "depositTransferId" TEXT,
ADD COLUMN "depositTransferredAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Booking_depositTransferId_key" ON "Booking"("depositTransferId");
```

- Adds two **empty, optional** columns to `Booking` and an index on one of
  them. Nothing is renamed, dropped or rewritten.
- Existing bookings, users, listings, payment records and Stripe references
  are untouched (every existing row gets NULL in the new columns; the
  unique index allows any number of NULLs).
- Adding nullable columns is instant in Postgres; the index build is
  near-instant on today's table size.
- Already applied to Preview; checked against the schema ("no difference");
  migration immutability check passes.

## 7. Remaining known issues (not blocking)

- A host who signs up with Google/Apple becomes a guest first and must tap
  "Become a host" (the role choice isn't carried through the provider).
- Hosts can't cancel a booking themselves (support does it) - needs your
  cancellation-policy decision.
- iCal token hardening and PMS property-id check (low, above).
- `refundChangeDifference` in `connectRefunds.ts` is now unused.

## 8. Recommended next phase (after launch)

1. Stripe live activation + real test-card run end to end.
2. Email that actually sends (Resend) and a check that fails loudly if not.
3. Host cancellation with your policy.
4. Automated guest messages (booking confirmation, check-in details).
5. Channex for real-time Airbnb / Booking.com / Vrbo sync.

## Releasing

Superseded by the release steps in
[production-readiness-audit.md](production-readiness-audit.md) (two migrations now).


1. GitHub → Actions → **Production database migration** → Run workflow:
   branch `claude/host-platform-upgrade`, `sha` = that branch's latest full
   commit SHA, drift check `report`. Approve it.
2. When it's green, tell Claude to merge the branch into
   `claude/airbnb-competitor-1fjjpk` (which deploys).
