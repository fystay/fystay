import Link from "next/link";
import { LegalPageLayout, LegalSection } from "@/components/legal/LegalPageLayout";
import { describeOperator, getCompanyInfo } from "@/lib/companyInfo";
import { PRIVACY_EMAIL, SITE_URL, pageMetadata } from "@/lib/seo";
import { appleSignInEnabled, googleSignInEnabled } from "@/lib/authProviders";
import { isPhoneVerificationConfigured } from "@/lib/phoneVerification";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description: "How FYStay collects, uses and protects your personal data.",
  path: "/legal/privacy",
});

const LAST_UPDATED = "1 October 2026";

export default function PrivacyPolicyPage() {
  const company = getCompanyInfo();
  const siteHost = new URL(SITE_URL).host;

  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <LegalSection heading="Who we are">
        <p>
          FYStay (&quot;we&quot;, &quot;us&quot;) operates {siteHost}, a booking platform
          for independent accommodation on the Fylde Coast. This policy explains what personal
          data we collect, why, and the rights you have over it under UK GDPR and the Data
          Protection Act 2018. For questions or to exercise any of the rights below, contact{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
            {PRIVACY_EMAIL}
          </a>
          .
        </p>
        {company && (
          <p>The data controller is {describeOperator(company)}.</p>
        )}
      </LegalSection>

      <LegalSection heading="What we collect">
        <p>We only collect what we need to run bookings and accounts:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-foreground">Account details:</span> name, email
            address, and a securely hashed password (we never store your password in plain text).
          </li>
          <li>
            <span className="font-medium text-foreground">Booking details:</span> check-in/check-out
            dates, guest numbers, and the listings you book, save, or review.
          </li>
          <li>
            <span className="font-medium text-foreground">Host listing details</span> (for hosts):
            property description, address, photos, pricing, and availability.
          </li>
          <li>
            <span className="font-medium text-foreground">Payment information:</span> handled
            entirely by Stripe. We receive confirmation that a payment succeeded and its amount,
            never your full card number.
          </li>
        </ul>
        <p>We do not collect any special category data, and we don&apos;t run behavioural advertising or ad-tracking cookies - see our <Link href="/legal/cookies" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">Cookie Policy</Link> for what we do use.</p>
      </LegalSection>

      <LegalSection heading="Why we use it, and our legal basis">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-foreground">To provide the service</span> (create
            your account, process a booking, show your trips, send booking emails) -
            <span className="italic"> necessary to perform our contract with you.</span>
          </li>
          <li>
            <span className="font-medium text-foreground">To keep the Platform secure</span> (preventing
            fraud, abuse, or unauthorised access) -
            <span className="italic"> our legitimate interest.</span>
          </li>
          <li>
            <span className="font-medium text-foreground">To meet legal obligations</span> (e.g.
            keeping payment records) -
            <span className="italic"> legal obligation.</span>
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <p>We share personal data only where it&apos;s needed to run the Platform:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-foreground">Stripe</span> - to process payments and
            refunds.
          </li>
          <li>
            <span className="font-medium text-foreground">Supabase</span> - our database and
            listing-photo storage provider.
          </li>
          <li>
            <span className="font-medium text-foreground">Resend</span> - to send account and
            booking emails (e.g. password reset).
          </li>
          <li>
            <span className="font-medium text-foreground">Vercel</span> - hosts the website, so
            it handles every request to it, including your IP address.
          </li>
          {process.env.SENTRY_DSN && (
            <li>
              <span className="font-medium text-foreground">Sentry</span> - error monitoring, so we
              can find and fix faults. An error report can include technical details of the request
              that failed.
            </li>
          )}
          {isPhoneVerificationConfigured() && (
            <li>
              <span className="font-medium text-foreground">Twilio</span> - to send the code that
              verifies your phone number, if you choose to verify it.
            </li>
          )}
          {googleSignInEnabled && (
            <li>
              <span className="font-medium text-foreground">Google</span> - if you choose to sign in
              with Google, to confirm your identity.
            </li>
          )}
          {appleSignInEnabled && (
            <li>
              <span className="font-medium text-foreground">Apple</span> - if you choose to sign in
              with Apple, to confirm your identity. If you use Apple&rsquo;s &ldquo;Hide My Email&rdquo;,
              our emails to you are forwarded by Apple.
            </li>
          )}
          <li>
            <span className="font-medium text-foreground">Trip extra providers</span> - if you buy
            a trip extra (such as an airport transfer), the provider receives your name, contact
            details, stay dates and any notes you add, so they can deliver it.
          </li>
          <li>
            <span className="font-medium text-foreground">The other party to a booking</span> -
            a host and guest can see each other&apos;s name and the booking details needed to
            complete the stay.
          </li>
        </ul>
        <p>
          Some of these providers may process data outside the UK. Where that happens, it&apos;s
          covered by adequacy regulations or standard contractual clauses recognised under UK
          GDPR, and each provider&apos;s own data processing terms.
        </p>
        <p>We never sell your personal data.</p>
      </LegalSection>

      <LegalSection heading="How long we keep it">
        <p>
          We keep account and booking data for as long as your account is active, and afterwards
          only as long as needed for legal, accounting, or dispute-resolution purposes (typically
          up to 6 years for financial records). You can ask us to delete your account at any time,
          subject to those retention requirements.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>Under UK GDPR, you have the right to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Access the personal data we hold about you.</li>
          <li>Ask us to correct inaccurate data.</li>
          <li>Ask us to delete your data (&quot;right to be forgotten&quot;), subject to any legal retention obligations.</li>
          <li>Ask us to restrict or object to certain processing.</li>
          <li>Receive your data in a portable format.</li>
          <li>Complain to the UK Information Commissioner&apos;s Office (ICO) at ico.org.uk if you think we&apos;ve mishandled your data.</li>
        </ul>
        <p>
          To exercise any of these, email{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
            {PRIVACY_EMAIL}
          </a>
          . We&apos;ll respond within one month.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          If we change how we handle your data, we&apos;ll update this page and the &quot;Last
          updated&quot; date above.
        </p>
      </LegalSection>
    </LegalPageLayout>
  );
}
