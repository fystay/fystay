import { CreditCard, Flag, HeartPulse, ShieldCheck, Star } from "lucide-react";
import { SUPPORT_EMAIL, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Safety information",
  description: "How FYStay keeps bookings, payments and stays on the Fylde Coast safe.",
  path: "/safety",
});

const POINTS = [
  {
    icon: CreditCard,
    title: "Pay through FYStay, not directly",
    description:
      "Always book and pay through FYStay's checkout. It's the only way your booking is protected by a host's cancellation policy and by our support team - never send money to a host directly.",
  },
  {
    icon: HeartPulse,
    title: "Physical safety at the property",
    description:
      "Hosts are required to meet UK safety standards for their property - working smoke alarms, a carbon monoxide alarm where relevant, a valid gas safety certificate, and fire-safe furniture. If you arrive somewhere that doesn't have working smoke alarms, or anything else feels unsafe, contact us immediately and don't hesitate to also contact the relevant emergency services if there's immediate danger.",
  },
  {
    icon: Star,
    title: "Genuine, verified reviews",
    description:
      "Only guests who've completed a paid stay can leave a review, so you're reading real feedback from real stays, not sign-up spam.",
  },
  {
    icon: Flag,
    title: "Report a problem",
    description:
      "You can report a review that looks abusive, fraudulent, or fake directly from the listing page. Our team reviews every report.",
  },
  {
    icon: ShieldCheck,
    title: "Secure account & payments",
    description:
      "Passwords are stored securely (never in plain text), and payments are handled entirely by Stripe's encrypted checkout - FYStay never sees your full card details.",
  },
];

export default function SafetyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Safety information</h1>
      <p className="mt-2 text-sm text-stone-500">
        How we help keep bookings, payments, and your account safe.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        {POINTS.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50">
              <Icon className="h-5 w-5 text-brand-700" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">{description}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-stone-500">
        If something feels wrong about a listing, a booking, or a message from another user,
        contact us straight away at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
