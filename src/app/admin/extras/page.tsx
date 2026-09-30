import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Send, Ticket } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SectionHeading } from "@/components/SectionHeading";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ExtraProviderForm } from "@/components/admin/ExtraProviderForm";
import { ExtraOfferingForm } from "@/components/admin/ExtraOfferingForm";
import { ToggleExtraActiveButton } from "@/components/admin/ToggleExtraActiveButton";
import { EditExtraProviderDialog } from "@/components/admin/EditExtraProviderDialog";
import { EditExtraOfferingDialog } from "@/components/admin/EditExtraOfferingDialog";
import { AdminNav } from "@/components/admin/AdminNav";
import { ExtraFulfillmentActions } from "@/components/admin/ExtraFulfillmentActions";
import { formatPrice } from "@/lib/format";
import { isFulfillmentStuck } from "@/lib/tripExtraFulfillment";

export const metadata: Metadata = { title: "Trip extras", robots: { index: false } };

const CATEGORY_LABELS: Record<string, string> = {
  AIRPORT_TRANSFER: "Airport transfer",
  ATTRACTION_TICKET: "Attraction ticket",
  CAR_HIRE: "Car hire",
};

const FULFILLMENT_BADGES: Record<
  string,
  { label: string; variant: "neutral" | "brand" | "success" | "warning" | "danger" }
> = {
  PENDING: { label: "Not handed over", variant: "neutral" },
  SENDING: { label: "Handing over", variant: "brand" },
  SENT: { label: "Sent - awaiting confirmation", variant: "warning" },
  CONFIRMED: { label: "Confirmed", variant: "success" },
  FAILED: { label: "Handoff failed", variant: "danger" },
};

/**
 * Manages Trip Extras providers/offerings (see docs/trip-extras-roadmap.md)
 * - the infrastructure Phase 2 of that roadmap called for, so onboarding
 * the next provider (attraction tickets, car hire, ...) is a form here
 * rather than hand-editing prisma/seed.ts the way EV Exec had to be in
 * Phase 1.
 */
export default async function AdminExtrasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/extras");
  if (session.user.role !== "ADMIN") redirect("/");

  const fulfillmentInclude = {
    offering: { select: { name: true, provider: { select: { name: true } } } },
    booking: { select: { guestName: true, checkIn: true } },
  } as const;
  // Everything still needing attention (not yet confirmed) first, oldest
  // payment first, then the most recent confirmed ones for context.
  const [providers, openExtras, confirmedExtras] = await Promise.all([
    prisma.extraProvider.findMany({
      include: { offerings: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.bookingExtra.findMany({
      where: { status: "PAID", fulfillmentStatus: { not: "CONFIRMED" } },
      include: fulfillmentInclude,
      orderBy: { paidAt: "asc" },
      take: 100,
    }),
    prisma.bookingExtra.findMany({
      where: { status: "PAID", fulfillmentStatus: "CONFIRMED" },
      include: fulfillmentInclude,
      orderBy: { fulfillmentConfirmedAt: "desc" },
      take: 10,
    }),
  ]);
  const paidExtras = [...openExtras, ...confirmedExtras];

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Trip extras</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Providers and offerings shown as add-ons on a guest&apos;s confirmed booking - see{" "}
        <code className="rounded bg-surface-muted px-1 py-0.5 text-xs">
          docs/trip-extras-roadmap.md
        </code>{" "}
        for the plan behind this.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/extras" />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <ExtraProviderForm />
        <ExtraOfferingForm
          providers={providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            category: provider.category as "AIRPORT_TRANSFER" | "ATTRACTION_TICKET" | "CAR_HIRE",
          }))}
        />
      </div>

      <div className="mt-8">
        <SectionHeading icon={Send}>Fulfilment</SectionHeading>
        <p className="mt-1 text-sm text-stone-500">
          Paid extras and whether the provider has them. Failed handoffs need a retry or a call
          to the provider.
        </p>
        {paidExtras.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No paid extras yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {paidExtras.map((extra) => {
              const badge = FULFILLMENT_BADGES[extra.fulfillmentStatus];
              const stuck = isFulfillmentStuck(extra);
              return (
                <Card key={extra.id}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground">{extra.offering.name}</p>
                        <Badge variant={badge.variant}>{stuck ? "Stuck handing over" : badge.label}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-stone-500">
                        {extra.offering.provider.name} · {extra.booking.guestName ?? "Guest"} · check-in{" "}
                        {extra.booking.checkIn.toLocaleDateString("en-GB")} ·{" "}
                        <span className="tabular-nums">{formatPrice(extra.priceCents)}</span> · attempts{" "}
                        <span className="tabular-nums">{extra.fulfillmentAttempts}</span>
                      </p>
                      {extra.fulfillmentReference && (
                        <p className="mt-1 text-sm text-stone-600">
                          Provider reference: <span className="font-mono">{extra.fulfillmentReference}</span>
                        </p>
                      )}
                      {extra.fulfillmentStatus === "FAILED" && extra.fulfillmentError && (
                        <p className="mt-1 text-sm text-red-700">{extra.fulfillmentError}</p>
                      )}
                    </div>
                    <ExtraFulfillmentActions
                      bookingExtraId={extra.id}
                      canRetry={extra.fulfillmentStatus === "PENDING" || extra.fulfillmentStatus === "FAILED" || stuck}
                      canConfirm={extra.fulfillmentStatus === "SENT" || extra.fulfillmentStatus === "FAILED"}
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-8">
        <SectionHeading icon={Building2}>Providers</SectionHeading>
        {providers.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No providers yet.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {providers.map((provider) => (
              <Card key={provider.id}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{provider.name}</p>
                        <Badge variant="brand">{CATEGORY_LABELS[provider.category] ?? provider.category}</Badge>
                        {!provider.active && <Badge variant="neutral">Deactivated</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-stone-500">
                        {provider.notificationEmail} · handoff by {provider.integration}
                      </p>
                      {provider.bookingFormUrl && (
                        <a
                          href={provider.bookingFormUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-brand-700 hover:underline"
                        >
                          Their booking page
                        </a>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <EditExtraProviderDialog
                        provider={{
                          id: provider.id,
                          name: provider.name,
                          category: provider.category as "AIRPORT_TRANSFER" | "ATTRACTION_TICKET" | "CAR_HIRE",
                          notificationEmail: provider.notificationEmail,
                          bookingFormUrl: provider.bookingFormUrl,
                        }}
                      />
                      <ToggleExtraActiveButton
                        endpoint={`/api/admin/extras/providers/${provider.id}`}
                        active={provider.active}
                        noun="Provider"
                      />
                    </div>
                  </div>

                  {provider.offerings.length > 0 && (
                    <div className="border-t border-border-subtle pt-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                        <Ticket className="h-3.5 w-3.5" aria-hidden />
                        Offerings
                      </p>
                      <div className="flex flex-col gap-2">
                        {provider.offerings.map((offering) => (
                          <div
                            key={offering.id}
                            className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2"
                          >
                            <div>
                              <p className="text-sm font-medium text-foreground">{offering.name}</p>
                              {offering.description && (
                                <p className="text-xs text-stone-500">{offering.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <p className="text-sm font-semibold tabular-nums text-foreground">
                                {formatPrice(offering.priceCents)}
                              </p>
                              {!offering.active && <Badge variant="neutral">Off</Badge>}
                              <EditExtraOfferingDialog
                                offering={{
                                  id: offering.id,
                                  name: offering.name,
                                  description: offering.description,
                                  priceCents: offering.priceCents,
                                  features: offering.features,
                                }}
                              />
                              <ToggleExtraActiveButton
                                endpoint={`/api/admin/extras/offerings/${offering.id}`}
                                active={offering.active}
                                noun="Offering"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
