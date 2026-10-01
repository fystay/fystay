import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { auth } from "@/auth";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { PMS_PROVIDER_LABEL } from "@/lib/pms/registry";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PropertyPicker } from "@/components/host/pms/PropertyPicker";
import { RoomMappingTable, type MappableListing } from "@/components/host/pms/RoomMappingTable";
import { DisconnectButton } from "@/components/host/pms/DisconnectButton";

export const metadata: Metadata = { title: "Manage integration", robots: { index: false } };

export default async function ManageIntegrationPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider: providerParam } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/integrations");
  if (session.user.role !== "HOST") redirect("/host");

  const provider = parseProvider(providerParam);
  if (!provider) notFound();

  const data = await withHostScope(session.user.id, async (tx) => {
    const connection = await tx.pmsConnection.findUnique({
      where: { hostId_provider: { hostId: session.user.id, provider } },
    });
    if (!connection || connection.status !== "CONNECTED") return null;

    const [listings, syncLogs] = await Promise.all([
      tx.listing.findMany({
        where: { hostId: session.user.id },
        select: { id: true, title: true, propertyType: true, roomTypes: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      tx.pmsSyncLog.findMany({
        where: { connectionId: connection.id },
        orderBy: { startedAt: "desc" },
        take: 10,
      }),
    ]);

    return { connection, listings, syncLogs };
  });

  if (!data) redirect("/host/integrations");
  const { connection, listings, syncLogs } = data;

  const label = PMS_PROVIDER_LABEL[provider];
  const providerPath = provider.toLowerCase();

  const mappableListings: MappableListing[] = listings;

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/host/integrations"
        className="focus-ring -ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-stone-600 hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to integrations
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{label}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {connection.externalPropertyName ?? "No property selected yet"}
          </p>
        </div>
        <DisconnectButton providerPath={providerPath} label={label} />
      </div>

      <div className="mt-6 flex flex-col gap-5">
        {!connection.externalPropertyId ? (
          <PropertyPicker providerPath={providerPath} label={label} />
        ) : (
          <RoomMappingTable providerPath={providerPath} listings={mappableListings} />
        )}

        <Card className="p-5">
          <CardHeader className="p-0">
            <CardTitle>Sync history</CardTitle>
          </CardHeader>
          <CardContent className="mt-3 p-0">
            {syncLogs.length === 0 ? (
              <p className="text-sm text-stone-500">No syncs yet - press &quot;Sync now&quot; to run one.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border-subtle">
                {syncLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        {formatDistanceToNow(log.startedAt, { addSuffix: true })}
                      </p>
                      {log.errorMessage && (
                        <p className="mt-0.5 truncate text-xs text-red-600" title={log.errorMessage}>
                          {log.errorMessage}
                        </p>
                      )}
                    </div>
                    <SyncStatusBadge status={log.status} recordCount={log.recordCount} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SyncStatusBadge({ status, recordCount }: { status: string; recordCount: number }) {
  if (status === "SUCCESS") return <Badge variant="success">{recordCount} synced</Badge>;
  if (status === "PARTIAL") return <Badge variant="warning">{recordCount} synced, some failed</Badge>;
  if (status === "SKIPPED") return <Badge variant="neutral">Skipped</Badge>;
  return <Badge variant="danger">Failed</Badge>;
}
