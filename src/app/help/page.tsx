import type { ReactNode } from "react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Help centre",
  description: "Answers to common questions about booking, hosting and managing your account on FYStay.",
  path: "/help",
});

// Each entry carries both a rendered answer (JSX, so it can link to other
// pages) and a plain-text version for the FAQPage structured data below -
// schema.org's acceptedAnswer.text wants plain text, not markup, so the two
// can't just share one value.
const FAQS: { question: string; answer: ReactNode; plainAnswer: string }[] = [
  {
    question: "How do I book a stay?",
    answer:
      "Search for a destination or hotel on the homepage, pick your dates and guest count, then choose a listing and press Book. You'll see the full price breakdown before you pay securely through Stripe.",
    plainAnswer:
      "Search for a destination or hotel on the homepage, pick your dates and guest count, then choose a listing and press Book. You'll see the full price breakdown before you pay securely through Stripe.",
  },
  {
    question: "How do I cancel or change a booking?",
    answer: (
      <>
        Go to <Link href="/bookings" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">My Trips</Link>,
        open the booking, and choose to cancel or request a date change. Any refund is calculated
        automatically from the listing&apos;s cancellation policy - see{" "}
        <Link href="/cancellation-policies" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
          Cancellation Policies
        </Link>{" "}
        for details.
      </>
    ),
    plainAnswer:
      "Go to My Trips, open the booking, and choose to cancel or request a date change. Any refund is calculated automatically from the listing's cancellation policy - see the Cancellation Policies page for details.",
  },
  {
    question: "How do payments and refunds work?",
    answer:
      "All payments and refunds are processed by Stripe. A confirmed refund is returned to your original payment method - Stripe's own processing times apply, typically 5-10 business days.",
    plainAnswer:
      "All payments and refunds are processed by Stripe. A confirmed refund is returned to your original payment method - Stripe's own processing times apply, typically 5-10 business days.",
  },
  {
    question: "How do I contact a host?",
    answer:
      "Once you have a confirmed booking, the host's contact details are shown on your booking's detail page so you can coordinate check-in.",
    plainAnswer:
      "Once you have a confirmed booking, the host's contact details are shown on your booking's detail page so you can coordinate check-in.",
  },
  {
    question: "How do I list my property?",
    answer: (
      <>
        Create a host account (or switch your existing account to hosting from{" "}
        <Link href="/register" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
          sign up
        </Link>
        ), then add your first listing from the host dashboard. See our{" "}
        <Link href="/host-guide" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
          Host guide
        </Link>{" "}
        for a full walkthrough.
      </>
    ),
    plainAnswer:
      "Create a host account (or switch your existing account to hosting from sign up), then add your first listing from the host dashboard. See the Host guide for a full walkthrough.",
  },
  {
    question: "I forgot my password - what do I do?",
    answer: (
      <>
        Use{" "}
        <Link href="/forgot-password" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
          Forgot password
        </Link>{" "}
        on the login page to get a secure reset link sent to your email.
      </>
    ),
    plainAnswer: "Use Forgot password on the login page to get a secure reset link sent to your email.",
  },
  {
    question: "How are reviews verified?",
    answer:
      "Only a guest who has completed a paid stay at a listing can leave a review for it, so every review reflects a genuine stay.",
    plainAnswer:
      "Only a guest who has completed a paid stay at a listing can leave a review for it, so every review reflects a genuine stay.",
  },
];

export default function HelpCenterPage() {
  // FAQPage structured data: the highest-value schema type for this page,
  // since both Google's FAQ rich results and AI answer engines (which
  // increasingly cite FAQ-marked-up content directly) parse this format to
  // lift question/answer pairs straight into a search result or a chat
  // answer without a click-through.
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(({ question, plainAnswer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: plainAnswer },
    })),
  };

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
      />
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Help centre</h1>
      <p className="mt-2 text-sm text-stone-500">
        Answers to common questions about booking, hosting, and managing your account.
      </p>

      <div className="mt-8 flex flex-col divide-y divide-border-subtle rounded-2xl border border-border-subtle bg-surface">
        {FAQS.map(({ question, answer }) => (
          <details key={question} className="group px-5 py-4 open:pb-4">
            <summary className="cursor-pointer list-none text-sm font-semibold text-foreground marker:content-none">
              {question}
            </summary>
            <div className="mt-2 text-sm leading-relaxed text-stone-600">{answer}</div>
          </details>
        ))}
      </div>

      <p className="mt-8 text-sm text-stone-500">
        Can&apos;t find what you&apos;re looking for?{" "}
        <Link href="/contact" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
          Contact us
        </Link>{" "}
        - or, if you&apos;re signed in,{" "}
        <Link href="/help/tickets/new" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
          open a support ticket
        </Link>{" "}
        and we&apos;ll reply here.
      </p>
    </div>
  );
}
