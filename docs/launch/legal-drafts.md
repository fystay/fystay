# Legal document drafts (for solicitor review)

**These are drafts, not legal advice.** They describe what the FYStay
software actually does, so a solicitor can check the legal wording against
real behaviour. Everything in `[SQUARE BRACKETS]` is information only you
can supply. Nothing here has been invented: where a fact is unknown, it's a
placeholder.

## A. Placeholders the live pages need

The live Terms, Privacy and Cookie pages (`/legal/terms`, `/legal/privacy`,
`/legal/cookies`) are already written in the app. They need these values,
set as Vercel variables (see `environment-variables.md`), not edited into code:

| Placeholder | Variable | Notes |
|---|---|---|
| `[LEGAL NAME OF OPERATOR]` | `NEXT_PUBLIC_COMPANY_LEGAL_NAME` | e.g. "Example Ltd", or "Jane Smith trading as FYStay" |
| `[REGISTERED / BUSINESS ADDRESS]` | `NEXT_PUBLIC_COMPANY_ADDRESS` | A limited company must show its registered office |
| `[COMPANY NUMBER]` | `NEXT_PUBLIC_COMPANY_NUMBER` | Only if incorporated; leave empty otherwise |
| `[SUPPORT EMAIL]` | `NEXT_PUBLIC_SUPPORT_EMAIL` | A mailbox you read |
| `[PRIVACY EMAIL]` | `NEXT_PUBLIC_PRIVACY_EMAIL` | For data-rights requests (one-month response deadline) |
| `[LEGAL EMAIL]` | `NEXT_PUBLIC_LEGAL_EMAIL` | |
| `[ICO REGISTRATION NUMBER]` | not yet shown on the site | Add it to the privacy page once registered, if your solicitor advises |
| `[VAT NUMBER]` | not yet shown on the site | Only if VAT-registered; ask your accountant whether it must appear on receipts |

## B. Questions for the solicitor about the existing pages

1. **Intermediary position.** The Terms say the accommodation contract is
   between guest and host, and FYStay "is not the provider of accommodation".
   FYStay also collects the full payment and keeps a 10% guest service fee,
   using Stripe Connect destination charges. Is the wording right for that
   flow? Does it fit the final chargeback-liability structure (pending the
   Stripe decision)?
2. **Consumer rights.** Is the cancellation-policy wording compatible with
   consumer law? (Accommodation for specific dates is generally outside the
   14-day cancellation right, but confirm.) The policies are:
   - **Flexible:** full refund up to 1 day before check-in.
   - **Moderate:** full refund 5+ days before, 50% up to 1 day before.
   - **Strict:** 50% refund 7+ days before.
   - **Custom:** set by the host.
3. **The service fee on cancellation.** Refunds follow the host's policy. Is
   the treatment of FYStay's 10% fee on refund stated clearly enough?
4. **Liability clause.** Is the limitation in section 8 of the Terms
   enforceable as written?
5. **Privacy.** The processor list (Stripe, Supabase, Resend, Vercel,
   trip-extra providers, plus Sentry, Twilio and Google when enabled) and the
   6-year retention statement.
6. **Cookies.** The site uses strictly necessary cookies only, with no
   analytics or advertising cookies, so there's no consent banner toggle.
   Confirm that stays compliant.
7. **Platform reporting.** Whether HMRC's digital-platform reporting rules
   apply to FYStay and require collecting host tax details.

## C. Draft host terms (new; nothing like this exists in the app yet)

> **FYStay Host Terms - DRAFT for solicitor review**
>
> These terms apply when you list accommodation on FYStay, operated by
> [LEGAL NAME OF OPERATOR] ([COMPANY NUMBER, if any]), [ADDRESS]
> ("FYStay"). They sit alongside the general Terms and Conditions.
>
> **1. Your listing.** You must own the property or be authorised to let it.
> Your listing (description, photos, amenities, price, availability and
> house rules) must be accurate and kept up to date. You are responsible for
> the property being safe, legal to let and as described, including any
> licences, planning permission, insurance, gas and fire safety obligations,
> and local requirements that apply to you. [SOLICITOR: confirm which
> obligations to name explicitly.]
>
> **2. Pricing and fees.** You set your nightly rate, cleaning fee and any
> discounts, and you receive those amounts. FYStay charges the guest a
> separate service fee of 10% shown at checkout. FYStay does not deduct a
> commission from your payout. [Referral credits and promo codes are funded
> by FYStay, not deducted from your payout.]
>
> **3. Payment and payouts.** Payments are taken through Stripe. To accept
> bookings you must connect a Stripe account. You must accept Stripe's
> Connected Account terms. Your share of each booking is transferred to your
> Stripe account as part of the payment, and Stripe pays it out to your bank
> on your Stripe payout schedule. You can't accept a paid booking until your
> Stripe account is able to receive payouts. [SOLICITOR: wording depends on
> the final Stripe structure, currently parked.]
>
> **4. Bookings.** With Instant Book on, a paid booking is confirmed
> automatically. With it off, you must accept or decline a request within
> 24 hours, or it expires. You must honour confirmed bookings.
>
> **5. Cancellations.** You choose a cancellation policy (Flexible,
> Moderate, Strict or Custom), and guests are refunded according to it. If
> you need to cancel a confirmed booking, contact FYStay support: FYStay
> cancels it and refunds the guest [in full]. [SOLICITOR/YOU: decide the
> guest refund and any host penalty. The software has no host-side cancel
> button; an admin cancels and sets the refund percentage.]
>
> **6. Date changes.** Guests may request date changes. You approve or
> decline them, and any price difference is charged or refunded through
> FYStay.
>
> **7. Security deposits.** If you set a security deposit, it's held on the
> guest's card, not charged. You may claim against it within 3 days after
> check-out, with a reason the guest will see. Otherwise it's released
> automatically.
>
> **8. Calendar sync.** If you sync calendars with other platforms (iCal or
> a property-management system), you remain responsible for avoiding double
> bookings.
>
> **9. Reviews.** Only guests who completed a paid stay can review. You may
> publicly respond. You must not offer incentives for reviews or ask guests
> to change them.
>
> **10. Conduct and off-platform payments.** You must not ask guests to pay
> outside FYStay for a booking made on FYStay. Discrimination against guests
> on any protected characteristic is prohibited.
>
> **11. Suspension and removal.** FYStay may suspend a listing that is
> inaccurate, unsafe, unlawful or in breach of these terms, and will show you
> the reason. FYStay may suspend accounts for serious or repeated breaches.
> [SOLICITOR: notice and appeal process.]
>
> **12. Taxes.** You are responsible for declaring your income and for any
> tax on it. [ACCOUNTANT/SOLICITOR: HMRC platform-reporting wording if
> applicable.]
>
> **13. Liability.** [SOLICITOR.]
>
> **14. Changes and termination.** [SOLICITOR.] You can stop hosting at any
> time. Existing confirmed bookings must still be honoured unless cancelled
> under section 5.
>
> **15. Governing law.** England and Wales.

**Once approved:** I'll add it as a `/legal/host-terms` page and require hosts
to accept it before publishing a listing. That's a small code change, best
made once the wording is final.
