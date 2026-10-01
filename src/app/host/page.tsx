import type { Metadata } from "next";
import Link from "next/link";
import { BecomeHostButton } from "@/components/BecomeHostButton";
import {
  Camera,
  Handshake,
  LayoutDashboard,
  MapPin,
  PoundSterling,
  Users,
} from "lucide-react";
import { auth } from "@/auth";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

const title = "List your property on the Fylde Coast";
const description =
  "List your Blackpool, Lytham, St Annes, Poulton-le-Fylde, Fleetwood or Thornton-Cleveleys property on FYStay. Reach local guests directly, manage bookings from one dashboard, and see exactly what you earn - no unsupported promises, just how it actually works.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/host` },
  openGraph: { title, description, url: `${SITE_URL}/host`, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

/**
 * Each reason is written as a direct, factual statement about how FYStay
 * itself works - never a claim about a competitor's fees, algorithm, or
 * conversion rate, since none of that is something this app could actually
 * support. The contrast with a large global platform is left implicit in
 * what FYStay deliberately doesn't do (no worldwide catalogue, no relay
 * between host and guest), not asserted as a fact about anyone else.
 */
const REASONS = [
  {
    icon: MapPin,
    title: "Local exposure, not a drop in a global ocean",
    description:
      "FYStay only ever shows guests stays on the Fylde Coast. Your listing sits alongside a handful of other local places, not millions of listings from every country.",
  },
  {
    icon: Users,
    title: "A genuinely local customer base",
    description:
      "Every search on FYStay is already scoped to Blackpool, Lytham, St Annes, Poulton-le-Fylde, Fleetwood or Thornton-Cleveleys - you're reaching people who've chosen this coast, not hoping to be noticed inside a worldwide catalogue.",
  },
  {
    icon: LayoutDashboard,
    title: "Simple, self-serve property management",
    description:
      "Your listing, calendar, availability, cancellation policy, bookings and reviews all live in one host dashboard - no separate apps or spreadsheets to keep in sync.",
  },
  {
    icon: Handshake,
    title: "A direct line to your guests",
    description:
      "Once a booking is confirmed, your contact details are right there on it for your guest - no anonymised relay or call centre standing between you and the person staying in your property.",
  },
  {
    icon: PoundSterling,
    title: "Transparent fees, shown upfront",
    description:
      "You set your own nightly rate and cleaning fee - that's what you earn per booking. FYStay's only charge is a service fee shown to the guest at checkout; it isn't deducted from your payout.",
  },
];

const STEPS = [
  {
    title: "1. Create your listing",
    description: "Add your property's title, description, location, price and details.",
  },
  {
    title: "2. Add real photos and amenities",
    description: "The details that help a guest choose your place with confidence.",
  },
  {
    title: "3. Set your availability and cancellation policy",
    description: "Flexible, Moderate, Strict, or a Custom policy - entirely your call.",
  },
  {
    title: "4. Publish and start hosting",
    description: "Manage bookings, message guests and respond to reviews from your dashboard.",
  },
];

export default async function BecomeAHostPage() {
  const session = await auth();
  const isHost = session?.user?.role === "HOST";
  // A signed-in guest upgrades this same account rather than registering a
  // second one (see /api/account/become-host).
  const isGuest = session?.user?.role === "GUEST";

  const ctaHref = isHost ? "/host/listings/new" : "/register?role=host";
  const ctaLabel = isHost ? "Add a new listing" : "List your property";
  const cta = (className: string) =>
    isGuest ? (
      <BecomeHostButton className={className}>{ctaLabel}</BecomeHostButton>
    ) : (
      <Link href={ctaHref} className={className}>
        {ctaLabel}
      </Link>
    );

  return (
    <div className="flex-1">
      {/* Full-bleed gradient hero, same brand-teal palette as the homepage
          hero and the search card's signature strip, so this reads as
          FYStay's own page rather than a bolted-on marketing microsite. */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600 px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-400 sm:text-sm">
            For Fylde Coast property owners
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight text-white sm:text-5xl">
            List your place on the Fylde Coast
          </h1>
          <p className="mt-4 text-base text-white/85 sm:text-lg">
            {SITE_NAME} is a booking platform built around one coastline, not a global
            marketplace you disappear into. List your apartment, cottage or guest house and
            reach guests who are already looking for a stay right here.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {cta(cn(buttonVariants({ size: "lg" }), "bg-white text-brand-800 hover:bg-white/90"))}
            <Link
              href="#how-it-works"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "border-white/30 text-white hover:bg-white/10",
              )}
            >
              See how it works
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-14">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            Why local hosts choose FYStay
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            No unsupported promises about bookings or earnings - just how the platform actually
            works for a host on this coast.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {REASONS.map(({ icon: Icon, title: reasonTitle, description: reasonDescription }) => (
            <div key={reasonTitle} className="flex flex-col gap-2 rounded-2xl border border-border-subtle bg-surface p-5 shadow-[var(--shadow-card)]">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Icon className="h-4.5 w-4.5" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-foreground">{reasonTitle}</p>
              <p className="text-sm leading-relaxed text-stone-600">{reasonDescription}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-y border-border-subtle bg-surface-muted">
        <div className="mx-auto max-w-3xl px-6 py-14">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">How listing works</h2>
          <p className="mt-1 text-sm text-stone-500">
            Four steps from an empty dashboard to a bookable listing.
          </p>
          <div className="mt-8 flex flex-col gap-6">
            {STEPS.map((step) => (
              <div key={step.title} className="flex items-start gap-3">
                <Camera className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-foreground">{step.title}</p>
                  <p className="mt-0.5 text-sm text-stone-600">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/host-guide"
            className="mt-6 inline-block text-sm font-medium text-brand-700 hover:underline"
          >
            Read the full host guide →
          </Link>
        </div>
      </section>

      <section className="px-6 py-14 text-center">
        <div className="mx-auto max-w-xl">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            Ready to welcome your first guest?
          </h2>
          <p className="mt-2 text-sm text-stone-500">
            It takes a few minutes to create a listing, and you choose when to publish it.
          </p>
          {cta(cn(buttonVariants({ size: "lg" }), "mt-6"))}
        </div>
      </section>
    </div>
  );
}
