import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EditorialHeader } from "@/components/EditorialHeader";
import * as Sentry from "@sentry/nextjs";
import { getActiveOfferings } from "@/lib/travelAddons";
import { TravelAddonCard } from "@/components/TravelAddonsSection";
import { FYSTAY_SERVICES, type FyStayService } from "@/lib/services";

// The same list as the /services hub, so the two never drift apart.
const [AIRPORT_TRANSFERS, ...OTHER_SERVICES] = FYSTAY_SERVICES.filter((service) => service.onHomepage);

/**
 * The homepage's Services: airport transfers as one wide panel - a live
 * partner's offer (EV Exec today, with its price) when there is one, else
 * FYStay's own transfers card - beside how adding one works, then the other
 * guest services as small links.
 */
export async function HomeServices() {
  // An optional extra: if offerings can't be read, FYStay's own card shows.
  const offerings = await getActiveOfferings().catch((error: unknown) => {
    console.error("Couldn't load travel offerings", error);
    Sentry.captureException(error);
    return [];
  });
  const transferOffer = offerings.find((offering) => offering.category === "AIRPORT_TRANSFER") ?? offerings[0];
  const provider = transferOffer?.providerName ?? "The transfer company";

  // Mirrors the steps on the transfer's own page (TravelAddonLanding).
  const steps = [
    "Book your stay on FYStay.",
    "Add a transfer from your booking page and pay with your FYStay account - no separate sign-up.",
    `${provider} contacts you directly to confirm the details. It shows on your FYStay booking too.`,
  ];

  return (
    <section className="mt-12 sm:mt-16" aria-labelledby="services-heading">
      <EditorialHeader
        id="services-heading"
        eyebrow="Services"
        title="Everything around your stay"
        link={{ href: "/services", label: "View all" }}
      />
      <div className="grid gap-6 rounded-[28px] border border-border-subtle bg-surface p-4 shadow-[var(--shadow-card)] sm:p-6 lg:grid-cols-[minmax(0,340px)_1fr] lg:items-center lg:gap-12 lg:p-8">
        {transferOffer ? <TravelAddonCard offering={transferOffer} /> : <TransfersCard service={AIRPORT_TRANSFERS} />}
        <div>
          <h3 className="font-serif text-xl font-bold leading-tight text-foreground sm:text-2xl">
            Sort your airport transfer with your stay
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-stone-500 sm:text-base">{AIRPORT_TRANSFERS.description}</p>
          <ol className="mt-5 space-y-3">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-3 text-sm text-stone-600">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-2">
        {OTHER_SERVICES.map(({ icon: Icon, title, href }) => (
          <li key={title}>
            <Link
              href={href}
              className="focus-ring group inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-brand-300 hover:text-brand-800"
            >
              <Icon className="h-4 w-4 text-brand-700" aria-hidden />
              {title}
              <ArrowRight className="h-3.5 w-3.5 text-stone-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** FYStay's own transfers card, shown when no partner offer is live. */
function TransfersCard({ service }: { service: FyStayService }) {
  const { icon: Icon, title, href, cta, gradient } = service;
  return (
    <Link
      href={href}
      className={`focus-ring group relative flex min-h-[180px] flex-col justify-end overflow-hidden rounded-[22px] bg-gradient-to-br ${gradient} p-5 text-white shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] lg:aspect-[4/3]`}
    >
      <Icon className="absolute -right-4 -top-4 h-32 w-32 text-white/10" aria-hidden />
      <Icon className="relative mb-3 h-6 w-6" aria-hidden />
      <h3 className="relative font-serif text-xl font-bold leading-tight">{title}</h3>
      <span className="relative mt-2 inline-flex items-center gap-1 text-sm font-medium">
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
