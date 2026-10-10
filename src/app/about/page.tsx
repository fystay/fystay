import Link from "next/link";
import { Lock, MapPin, Star } from "lucide-react";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "About",
  description: "Why FYStay - For Your Stay - exists: a local holiday accommodation marketplace that started on Blackpool and the Fylde Coast.",
  path: "/about",
});

const VALUES = [
  {
    icon: MapPin,
    title: "Local, not corporate",
    description:
      "Every stay on FYStay is listed directly by its own independent host - not resold or aggregated from a big chain.",
  },
  {
    icon: Star,
    title: "Reviews you can trust",
    description:
      "Only guests who've completed a paid stay can leave a review, so ratings reflect real experiences, not sign-up spam.",
  },
  {
    icon: Lock,
    title: "Secure by default",
    description:
      "Payments run through Stripe's encrypted checkout. We never see or store your full card details.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">About FYStay</h1>
      <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-brand-700">
        For Your Stay
      </p>
      <p className="mt-4 text-sm leading-relaxed text-stone-600">
        FYStay stands for &ldquo;For Your Stay&rdquo;: a booking platform for independent holiday
        accommodation, and a local alternative to the big booking platforms. We started on
        Blackpool and the Fylde Coast, and plan to grow across Lancashire, the North West and
        beyond as local hosts join, because the region is full of great, independently run places
        to stay that deserve a straightforward way to reach guests directly - without
        disappearing into a global marketplace alongside thousands of listings from everywhere
        else.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-stone-600">
        Guests get a simple way to search, compare, and book real local stays with genuine
        reviews. Hosts get a dashboard to manage listings, availability, pricing, and bookings
        without giving up a large cut of every booking to a global platform.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {VALUES.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex flex-col gap-2">
            <Icon className="h-5 w-5 text-brand-700" />
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-sm text-stone-500">{description}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/host" className={cn(buttonVariants())}>
          Host your place
        </Link>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          Browse stays
        </Link>
      </div>
    </div>
  );
}
