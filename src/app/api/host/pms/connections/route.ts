import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { isPmsProviderConnectable, PMS_PROVIDER_LABEL } from "@/lib/pms/registry";
import { withApiErrorHandling } from "@/lib/apiError";

export type PmsConnectionSummary = {
  provider: string;
  label: string;
  live: boolean;
  connected: boolean;
  status: string;
  externalPropertyName: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  // How many of this connection's PMS rooms are mapped to a FYStay
  // listing/room type. There's no cheap "how many rooms does the PMS
  // have" count without a live API call (see the [provider]/rooms route,
  // which the mapping UI calls on demand instead) - this summary list
  // shows mappedCount alone rather than an "X/Y mapped" fraction that
  // would need that extra round trip just to render the dashboard.
  mappedCount: number;
};

/**
 * Every provider (CLOUDBEDS/SITEMINDER/SUPERCONTROL) as one row each, not
 * just the ones this host has actually connected - the integrations page
 * always shows all three ("Connect" for the two not yet set up), matching
 * the brief's own "Cloudbeds — Connected ... SiteMinder — Connect" example.
 */
async function getHandler() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connections = await withHostScope(session.user.id, (tx) =>
    tx.pmsConnection.findMany({
      where: { hostId: session.user.id },
      include: { roomMappings: true },
    }),
  );
  const byProvider = new Map(connections.map((c) => [c.provider, c]));

  const summaries: PmsConnectionSummary[] = (Object.keys(PMS_PROVIDER_LABEL) as (keyof typeof PMS_PROVIDER_LABEL)[]).map(
    (provider) => {
      const connection = byProvider.get(provider);
      return {
        provider,
        label: PMS_PROVIDER_LABEL[provider],
        live: isPmsProviderConnectable(provider),
        connected: connection?.status === "CONNECTED",
        status: connection?.status ?? "DISCONNECTED",
        externalPropertyName: connection?.externalPropertyName ?? null,
        connectedAt: connection?.connectedAt?.toISOString() ?? null,
        lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
        lastSyncStatus: connection?.lastSyncStatus ?? null,
        lastSyncError: connection?.lastSyncError ?? null,
        mappedCount: connection?.roomMappings.length ?? 0,
      };
    },
  );

  return NextResponse.json({ connections: summaries });
}

export const GET = withApiErrorHandling(getHandler);
