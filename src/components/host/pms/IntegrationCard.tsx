"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { RefreshCw, Settings } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export type IntegrationSummary = {
  provider: string;
  label: string;
  live: boolean;
  connected: boolean;
  status: string;
  externalPropertyName: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  mappedCount: number;
};

export function IntegrationCard({ summary }: { summary: IntegrationSummary }) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const providerPath = summary.provider.toLowerCase();

  async function handleConnect() {
    setConnecting(true);
    const res = await fetch(`/api/host/pms/connections/${providerPath}/connect`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setConnecting(false);
      toast.error(data.error ?? `Couldn't connect to ${summary.label}.`);
      return;
    }
    if (data.authorizationUrl) {
      window.location.href = data.authorizationUrl;
      return;
    }
    setConnecting(false);
    toast.success(`Connected to ${summary.label}`);
    router.refresh();
  }

  async function handleSyncNow() {
    setSyncing(true);
    const res = await fetch(`/api/host/pms/connections/${providerPath}/sync`, { method: "POST" });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't sync right now.");
      return;
    }
    const errorCount = data.summary?.errors?.length ?? 0;
    toast[errorCount > 0 ? "warning" : "success"](
      errorCount > 0
        ? `Synced with ${errorCount} issue${errorCount === 1 ? "" : "s"} - see Manage for details.`
        : `${summary.label} synced`,
    );
    router.refresh();
  }

  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">{summary.label}</h2>
          <StatusBadge summary={summary} />
        </div>
        <div className="mt-1.5 flex flex-col gap-0.5 text-sm text-stone-500">
          {summary.connected ? (
            <>
              {summary.externalPropertyName ? (
                <span>Property: {summary.externalPropertyName}</span>
              ) : (
                <span className="text-amber-700">No property selected yet</span>
              )}
              <span>
                {summary.mappedCount} room{summary.mappedCount === 1 ? "" : "s"} mapped
              </span>
              <span>
                Last sync:{" "}
                {summary.lastSyncedAt
                  ? formatDistanceToNow(new Date(summary.lastSyncedAt), { addSuffix: true })
                  : "never"}
              </span>
              {summary.lastSyncStatus === "FAILURE" && summary.lastSyncError && (
                <span className="text-red-600">{summary.lastSyncError}</span>
              )}
            </>
          ) : summary.live ? (
            <span>Not connected</span>
          ) : (
            <span>Coming soon.</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {summary.connected ? (
          <>
            <Button variant="outline" size="sm" onClick={handleSyncNow} loading={syncing}>
              <RefreshCw className="h-4 w-4" />
              Sync now
            </Button>
            <Link
              href={`/host/integrations/${providerPath}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            >
              <Settings className="h-4 w-4" />
              Manage
            </Link>
          </>
        ) : (
          <Button size="sm" onClick={handleConnect} loading={connecting} disabled={!summary.live}>
            Connect
          </Button>
        )}
      </div>
    </Card>
  );
}

function StatusBadge({ summary }: { summary: IntegrationSummary }) {
  if (!summary.connected) {
    return <Badge variant="neutral">{summary.live ? "Not connected" : "Coming soon"}</Badge>;
  }
  if (summary.lastSyncStatus === "FAILURE") return <Badge variant="danger">Sync error</Badge>;
  if (summary.status === "ERROR") return <Badge variant="danger">Connection error</Badge>;
  return <Badge variant="success">Connected</Badge>;
}
