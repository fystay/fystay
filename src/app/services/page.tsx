import Link from "next/link";
import { ArrowRight, Car, Home, LifeBuoy } from "lucide-react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Services",
  description: "Everything FYStay offers beyond the stay itself - trip extras, hosting and help - in one place.",
  path: "/services",
});

// Only services that already exist in the app, each linking to its real
// page. New services (see src/lib/siteSections.ts) get added here as they launch.
const SERVICES = [
  {
    icon: Car,
    title: "Trip extras",
    description: "Add extras such as transport to a confirmed FYStay booking.",
    href: "/travel-extras",
    cta: "See trip extras",
  },
  {
    icon: Home,
    title: "Hosting",
    description: "List your property and manage bookings, calendars and payouts from one dashboard.",
    href: "/host-guide",
    cta: "Read the host guide",
  },
  {
    icon: LifeBuoy,
    title: "Help & support",
    description: "Answers to common questions, and a way to contact the FYStay team.",
    href: "/help",
    cta: "Go to the help centre",
  },
];

export default function ServicesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Services</h1>
      <p className="mt-2 max-w-2xl text-sm text-stone-500 sm:text-base">
        Everything FYStay offers beyond the stay itself. More services for guests and hosts will appear
        here as they launch.
      </p>

      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {SERVICES.map(({ icon: Icon, title, description, href, cta }) => (
          <li key={title}>
            <Link
              href={href}
              className="focus-ring group flex h-full flex-col rounded-2xl border border-border-subtle bg-surface p-6 transition-shadow hover:shadow-md"
            >
              <Icon className="h-6 w-6 text-brand-700" aria-hidden />
              <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
              <p className="mt-1 flex-1 text-sm text-stone-500">{description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 group-hover:text-brand-800">
                {cta}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
