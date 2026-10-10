import Link from "next/link";
import { LegalPageLayout, LegalSection } from "@/components/legal/LegalPageLayout";
import { describeOperator, getCompanyInfo } from "@/lib/companyInfo";
import { LEGAL_EMAIL, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Terms and Conditions",
  description: "The terms that govern using FYStay to book or list accommodation on the Fylde Coast.",
  path: "/legal/terms",
});

const LAST_UPDATED = "31 August 2026";

export default function TermsPage() {
  const company = getCompanyInfo();

  return (
    <LegalPageLayout title="Terms and Conditions" lastUpdated={LAST_UPDATED}>
      <LegalSection heading="1. Who these terms are between">
        <p>
          These terms govern your use of FYStay (the &quot;Platform&quot;), a website that lets
          guests search for and book independent accommodation on the Fylde Coast, and lets hosts
          list their properties for guests to book. By creating an account, browsing listings, or
          making a booking, you agree to these terms.
        </p>
        <p>
          FYStay acts as a booking platform connecting guests and hosts. Unless stated otherwise,
          the accommodation contract for a stay is between the guest and the host, not with
          FYStay.
        </p>
        {company && (
          <p>FYStay is operated by {describeOperator(company)}.</p>
        )}
      </LegalSection>

      <LegalSection heading="2. Accounts">
        <p>
          You must provide accurate information when creating an account and keep your login
          details secure. You must be at least 18 years old to create an account, make a booking,
          or list a property. You&apos;re responsible for all activity that happens under your
          account.
        </p>
      </LegalSection>

      <LegalSection heading="3. Bookings and payment">
        <p>
          When you book a listing, you agree to pay the total price shown at checkout, including
          the nightly rate, any cleaning fee, and any service fee. Payments are processed securely
          by Stripe; FYStay does not receive or store your full card details.
        </p>
        <p>
          A booking is confirmed once payment has been successfully processed. You&apos;ll receive
          a booking reference and confirmation, and can view the full price breakdown and receipt
          at any time from your account.
        </p>
      </LegalSection>

      <LegalSection heading="4. Cancellations and refunds">
        <p>
          Each listing has a cancellation policy set by its host (Flexible, Moderate, Strict,
          Non-refundable, or a host-defined Custom policy), shown on the listing page before you
          book. Refund amounts for a cancellation are calculated automatically based on that policy
          and how far in advance you cancel (or, under Non-refundable, whether you cancel within 24
          hours of paying). See our{" "}
          <Link href="/cancellation-policies" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
            Cancellation Policies
          </Link>{" "}
          page for full details.
        </p>
        <p>
          You can request a date change instead of cancelling; a host must approve the change,
          and you&apos;ll be shown any price difference before confirming.
        </p>
      </LegalSection>

      <LegalSection heading="5. Hosting">
        <p>
          Hosts are responsible for the accuracy of their listings (description, photos, pricing,
          availability, and amenities), for the property being safe and as described, and for
          honouring confirmed bookings. FYStay may remove a listing that is inaccurate, unsafe,
          or breaches these terms.
        </p>
      </LegalSection>

      <LegalSection heading="6. Reviews">
        <p>
          Only a guest who has completed a paid stay at a listing can leave a review for it, so
          reviews on FYStay reflect genuine stays. Hosts may publicly respond to a review. Reviews
          that are abusive, fraudulent, or unrelated to the stay can be reported and may be
          removed.
        </p>
      </LegalSection>

      <LegalSection heading="7. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Use the Platform for any unlawful purpose, or to circumvent a booking to avoid fees.</li>
          <li>Post false, misleading, or infringing content (listings, photos, or reviews).</li>
          <li>Attempt to disrupt, reverse-engineer, or gain unauthorised access to the Platform.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="8. Liability">
        <p>
          FYStay provides the Platform to connect guests and hosts but is not the provider of
          accommodation. To the fullest extent permitted by law, FYStay is not liable for the
          condition of a listed property, the conduct of a guest or host, or indirect or
          consequential losses arising from a booking. Nothing in these terms limits liability
          that cannot be limited under English law, including for fraud or death or personal
          injury caused by negligence.
        </p>
      </LegalSection>

      <LegalSection heading="9. Changes to these terms">
        <p>
          We may update these terms from time to time, for example as the Platform&apos;s features
          change. We&apos;ll update the &quot;Last updated&quot; date above when we do. Continuing
          to use FYStay after a change means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection heading="10. Governing law">
        <p>
          These terms are governed by the laws of England and Wales, and any dispute will be
          subject to the exclusive jurisdiction of the courts of England and Wales.
        </p>
      </LegalSection>

      <LegalSection heading="11. Contact us">
        <p>
          Questions about these terms can be sent to{" "}
          <a href={`mailto:${LEGAL_EMAIL}`} className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
            {LEGAL_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
