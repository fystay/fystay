# Stripe and email: what to configure for the live site

Everything here is entered by you, in the Stripe, Resend and Vercel
dashboards. No secret value belongs in chat, in Git or in a ticket: copy
each one straight from the provider into Vercel and mark it **Sensitive**.
Every change needs a fresh Production build to take effect (see
[launch-runbook.md](launch-runbook.md), golden rules).

The code already handles all of this. Until a setting exists, the feature
is switched off safely: no Stripe key means payments are refused, and no
email key means nothing is sent.

## Preview (test) and Production (live) never mix

| | Preview (testing) | Production (live site) |
|---|---|---|
| Stripe account mode | "FYStay sandbox" (test mode), already set up | Your Stripe account in **live mode** |
| `STRIPE_SECRET_KEY` | `sk_test_...` (set) | `sk_live_...` (you add it) |
| Webhooks | Sandbox endpoints pointing at the Preview branch address (set) | New live-mode endpoints pointing at the live domain |
| Cards | Test cards only (4242 4242 4242 4242) | Real cards |
| Email | Not configured, so nothing is sent | Resend with your own domain |

The app enforces the split itself (`stripeKeyMatchesEnvironment` in
`src/lib/stripe.ts`). A test key on Production is ignored, so payments are
refused rather than taken in test mode. A live key on Preview is ignored,
so no real card can ever be charged from a test site.

## 1. Stripe, live mode

### Variables (Vercel, Production only, all Sensitive)

| Variable | Where it comes from |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe, live mode → Developers → API keys → Secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | The signing secret (`whsec_...`) of webhook endpoint A below |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | The signing secret of webhook endpoint B below |

There's no publishable key to add. Checkout is Stripe's own hosted page,
so `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` isn't read by the app.

### Webhook endpoints (Stripe, live mode → Developers → Webhooks)

Both use the same address: **`https://<your live domain>/api/webhooks/stripe`**
(today that's `https://fystay.vercel.app/api/webhooks/stripe`; change it when
the custom domain goes live). Set the **API version** to `2026-08-26.dahlia`,
the version the app's Stripe library speaks.

**A. "Your account" events**, giving `STRIPE_WEBHOOK_SECRET`:
- `checkout.session.completed`: payment received, so the booking is confirmed and emails are sent
- `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`: delayed payment methods (harmless today, since checkout is card-only)
- `checkout.session.expired`: abandoned payment page, so the dates are freed and credit or promo returned
- `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`: chargebacks, alerting `DISPUTE_ALERT_EMAIL`
- `identity.verification_session.verified`, `identity.verification_session.requires_input`: host ID checks (only if you turn on Stripe Identity)

**B. "Connected accounts" events**, giving `STRIPE_CONNECT_WEBHOOK_SECRET`:
- `account.updated`: keeps each host's payout status current. Hosts also get a fresh check when they come back from Stripe onboarding.

Refunds need no webhook: the app makes them directly when a guest cancels.

### Dashboard settings (live mode)

1. **Activate the account**: business details, plus the bank account FYStay's fees are paid into.
2. **Connect**: turn it on and complete the platform profile as a **marketplace**. Match what the code creates:
   - hosts are UK **recipient** accounts with the **Express** dashboard;
   - **FYStay collects the fees and is responsible for losses** (refunds or disputes a host can't cover);
   - payments are **destination charges**, so FYStay is the merchant of record and the host receives the stay plus cleaning fee, while FYStay keeps the 10% service fee.
3. **Connect branding**: name "FYStay", icon and colour. Hosts see these during payout setup.
4. **Public details**: business name "FYStay", support email, website, and a **statement descriptor** such as `FYSTAY`, so guests recognise the charge on their bank statement. Today it shows as "Stripe", which invites chargebacks.
5. **Checkout branding**: logo and brand colour. The test page currently says "FYStay sandbox" in Stripe's default blue.
6. Optional: **Stripe Identity** (host ID badge). Needs Stripe's approval in live mode. Without it, the "Verify your identity" step says it isn't available.
7. Optional: Stripe's own email receipts. FYStay already sends its own confirmation, so leave these off to avoid two emails.

### First live check (after the Production build)

Make one real booking with your own card, then cancel it under a flexible
policy. Check in Stripe that:
- the charge equals the checkout total;
- the host's connected account received the stay plus cleaning fee;
- FYStay kept the service fee;
- the refund went through;
- the booking shows as confirmed, then cancelled with the refund, in My trips and on the host dashboard.

## 2. Email (Resend)

### Variables (Vercel, Production only)

| Variable | Value | Sensitive? |
|---|---|---|
| `RESEND_API_KEY` | Resend → API Keys → **Sending access**, restricted to your domain | Yes |
| `EMAIL_FROM` | e.g. `FYStay <bookings@mail.yourdomain>`, on the verified domain | No |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | The real support inbox. It's the reply address in every email footer. | No (public) |
| `DISPUTE_ALERT_EMAIL` | Optional: who gets chargeback alerts (defaults to support) | No |

Resend setup: add a sending subdomain (e.g. `mail.yourdomain`), preferably
in the EU (Ireland) region. Add the SPF, DKIM and bounce MX records it shows,
plus a DMARC record (`_dmarc`, starting `p=none`). Wait for **Verified**
before setting `EMAIL_FROM`. Until then Resend only delivers to the Resend
account owner.

### What gets sent, and when

| Email | Sent to | When |
|---|---|---|
| Booking confirmed (also the payment confirmation) | Guest | Stripe confirms payment |
| New booking | Host | Same moment |
| Booking request / reply | Host, then guest | Request-to-book listings only |
| Booking cancelled, with the refund amount and timing | Guest and host | Guest cancels |
| Booking not completed, refunded | Guest | A payment arrives for dates that were taken meanwhile; refunded in full automatically |
| Arrival reminder (address, check-in details) | Guest | Daily job at 10:00 UTC (11:00 UK summer time), before check-in |
| Review request | Guest | Daily job, after check-out |
| Security deposit request / outcome | Guest | Listings with a deposit |
| Transfer booked | Guest and EV Exec | An airport transfer is paid for |
| Spotlight booked | Host | A host pays for Spotlight |
| Chargeback alert | FYStay | A dispute opens |
| Password reset | Account holder | "Forgot password" |
| Confirm new email / email changed | Old and new address | Email change in account settings |

Without `RESEND_API_KEY`, **none of these send**, including password resets,
so a guest who forgets their password can't get back in. That's why email
is a launch blocker. There's no welcome or sign-up verification email: a
guest can sign up and book without one.

### First live check

Request a password reset on the live site. Then make the real booking from
the Stripe check above and confirm both the guest and host emails arrive,
not in spam, with working links to the live domain.
