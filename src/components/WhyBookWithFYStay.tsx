import Link from "next/link";
import { Lock, MapPinned, MessageCircle, ShieldCheck } from "lucide-react";
import { SectionHeading } from "@/components/SectionHeading";

// Every claim here maps to something this codebase actually does today -
// nothing about response times, "guarantees", or verification the platform
// doesn't track. See src/app/api/webhooks/stripe/route.ts (payments),
// src/app/api/conversations/route.ts (host messaging), the Review model's
// bookingId FK (a review can't exist without a completed, paid booking),
// and /help + /contact (the real support channel behind SupportWidget).
const REASONS = [
  {
    icon: Lock,
    title: "Secure payments",
    description: "Payments are processed securely through Stripe - FYStay never sees or stores your card details.",
  },
  {
    icon: MapPinned,
    title: "Genuinely local",
    description: "Every stay is in North West England, not a generic listing pulled in from anywhere else.",
  },
  {
    icon: MessageCircle,
    title: "Direct host contact",
    description: "Message your host through FYStay before and after you book, with no separate app to install.",
  },
  {
    icon: ShieldCheck,
    title: "Reviews from real stays",
    description: "Only a guest who has completed a paid booking at a property can leave a review for it.",
  },
];

export function WhyBookWithFYStay() {
  return (
    <div className="mt-10">
      <SectionHeading icon={ShieldCheck}>Why book with FYStay</SectionHeading>
      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {REASONS.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <Icon className="h-4.5 w-4.5" aria-hidden />
            </span>
            <div>
              <p className="font-medium text-foreground">{title}</p>
              <p className="mt-0.5 text-sm text-stone-600">{description}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-sm text-stone-500">
        Have a question before you book?{" "}
        <Link href="/help" className="font-medium text-brand-700 underline-offset-2 hover:underline">
          Visit FYStay support
        </Link>
        .
      </p>
    </div>
  );
}
