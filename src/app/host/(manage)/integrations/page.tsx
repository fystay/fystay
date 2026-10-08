import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { isPmsProviderConnectable, PMS_PROVIDER_LABEL } from "@/lib/pms/registry";
import { IntegrationCard, type IntegrationSummary } from "@/components/host/pms/IntegrationCard";
import { IntegrationBanner } from "@/components/host/pms/IntegrationBanner";

export const metadata: Metadata = { title: "Channels", robots: { index: false } };

export default async function HostIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ pms_connected?: string; pms_error?: string }>;
}) {
  const { pms_connected, pms_error } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/integrations");
  if (session.user.role !== "HOST") redirect("/host");

  const connections = await withHostScope(session.user.id, (tx) =>
    tx.pmsConnection.findMany({
      where: { hostId: session.user.id },
      include: { roomMappings: true },
    }),
  );
  const byProvider = new Map(connections.map((c) => [c.provider, c]));

  const summaries: IntegrationSummary[] = (
    Object.keys(PMS_PROVIDER_LABEL) as (keyof typeof PMS_PROVIDER_LABEL)[]
  ).map((provider) => {
    const connection = byProvider.get(provider);
    return {
      provider,
      label: PMS_PROVIDER_LABEL[provider],
      live: isPmsProviderConnectable(provider),
      connected: connection?.status === "CONNECTED",
      status: connection?.status ?? "DISCONNECTED",
      externalPropertyName: connection?.externalPropertyName ?? null,
      lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
      lastSyncStatus: connection?.lastSyncStatus ?? null,
      lastSyncError: connection?.lastSyncError ?? null,
      mappedCount: connection?.roomMappings.length ?? 0,
    };
  });

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/host/dashboard"
        className="focus-ring -ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-foreground">Channels</h1>
      <p className="mt-1 text-sm text-stone-500">
        Connect a property management or channel manager system so your rooms, rates and
        bookings stay in sync automatically.
      </p>

      <IntegrationBanner connectedProvider={pms_connected} errorReason={pms_error} />

      <div className="mt-6 flex flex-col gap-4">
        {summaries.map((summary) => (
          <IntegrationCard key={summary.provider} summary={summary} />
        ))}
      </div>
    </div>
  );
}
