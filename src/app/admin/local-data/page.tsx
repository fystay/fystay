import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Activity, Database, RefreshCw, Sparkles } from "lucide-react";
import { auth } from "@/auth";
import {
  getLocalDataAdminSummary,
  type SourceStatus,
  type SourceSummary,
} from "@/lib/localData/adminSummary";
import { SectionHeading } from "@/components/SectionHeading";
import { StatCard } from "@/components/host/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { AdminNav } from "@/components/admin/AdminNav";

export const metadata: Metadata = { title: "Local data platform", robots: { index: false } };

const STATUS_LABEL: Record<SourceStatus, string> = {
  LIVE: "Live",
  FAILING: "Failing",
  DISABLED: "Not configured",
  NEVER_RUN: "Never run",
};

const STATUS_VARIANT: Record<SourceStatus, BadgeProps["variant"]> = {
  LIVE: "success",
  FAILING: "danger",
  DISABLED: "neutral",
  NEVER_RUN: "warning",
};

function relativeOrNever(date: Date | null): string {
  return date ? formatDistanceToNow(date, { addSuffix: true }) : "Never";
}

function SourceRow({ source }: { source: SourceSummary }) {
  return (
    <tr className="border-b border-border-subtle last:border-0">
      <td className="py-3 pr-4">
        <p className="font-medium text-foreground">{source.label}</p>
        {source.lastAttempt?.status === "FAILURE" && source.lastAttempt.errorMessage && (
          <p className="mt-0.5 max-w-sm truncate text-xs text-red-600" title={source.lastAttempt.errorMessage}>
            {source.lastAttempt.errorMessage}
          </p>
        )}
      </td>
      <td className="py-3 pr-4">
        <Badge variant={STATUS_VARIANT[source.status]}>{STATUS_LABEL[source.status]}</Badge>
      </td>
      <td className="py-3 pr-4 text-stone-600">{relativeOrNever(source.lastSuccessAt)}</td>
      <td className="py-3 pr-4 font-mono tabular-nums text-stone-700">{source.recordCount.toLocaleString()}</td>
      <td className="py-3 pr-4 font-mono tabular-nums text-stone-700">
        <span className={source.failuresLast7Days > 0 ? "font-semibold text-red-600" : undefined}>
          {source.failuresLast7Days}
        </span>{" "}
        <span className="text-xs text-stone-500">/ 7d</span>
      </td>
      <td className="py-3 font-mono tabular-nums text-stone-700">
        {source.syncRunsLast24h} <span className="text-xs text-stone-500">/ 24h</span>
      </td>
    </tr>
  );
}

/**
 * Read-only operational view of the local-data platform (src/lib/localData/)
 * for the one FYStay admin, not guests or hosts - per the brief's "admin
 * dashboard where I can see: API status, last successful refresh, number of
 * records, failed requests, API usage, data source, manually featured
 * recommendations". Every number here reads straight from ApiSyncLog and
 * the live tables themselves (see adminSummary.ts) rather than a separate
 * metrics pipeline, so what this page shows is never out of sync with what
 * the site is actually serving.
 */
export default async function LocalDataAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/local-data");
  if (session.user.role !== "ADMIN") redirect("/");

  const summary = await getLocalDataAdminSummary();
  const failingSources = summary.sources.filter((s) => s.status === "FAILING").length;

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Local data platform</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Operational status for the Local Guide&apos;s live data - weather, places and events feeding the
        &quot;Right now&quot; concierge panel on every town&apos;s destination page.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/local-data" />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Database} label="Towns covered" value={summary.towns.toString()} />
        <StatCard
          icon={Sparkles}
          label="Featured picks"
          value={summary.featured.length.toString()}
          sublabel="FYStay editorial"
        />
        <StatCard
          icon={Activity}
          label="Sources failing"
          value={failingSources.toString()}
          sublabel={failingSources > 0 ? "needs attention" : "all healthy"}
        />
        <StatCard
          icon={RefreshCw}
          label="Last generated"
          value={formatDistanceToNow(summary.generatedAt, { addSuffix: true })}
          sublabel="this page's own data"
        />
      </div>

      <div className="mt-8">
        <SectionHeading icon={Activity}>API status</SectionHeading>
        <Card className="mt-4 overflow-x-auto">
          <CardContent className="pt-5">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-xs font-medium uppercase tracking-wide text-stone-500">
                  <th className="pb-2 pr-4 font-medium">Data source</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Last successful refresh</th>
                  <th className="pb-2 pr-4 font-medium">Records</th>
                  <th className="pb-2 pr-4 font-medium">Failed requests</th>
                  <th className="pb-2 font-medium">API usage</th>
                </tr>
              </thead>
              <tbody>
                {summary.sources.map((source) => (
                  <SourceRow key={source.source} source={source} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <SectionHeading icon={Sparkles}>Manually featured recommendations</SectionHeading>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
          Every FYStay editorial pick currently live on a destination page&apos;s concierge panel and Local
          Guide, in the order each town shows them.
        </p>
        <Card className="mt-4 overflow-x-auto">
          <CardContent className="pt-5">
            {summary.featured.length === 0 ? (
              <p className="py-4 text-sm text-stone-500">No editorial recommendations yet.</p>
            ) : (
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-xs font-medium uppercase tracking-wide text-stone-500">
                    <th className="pb-2 pr-4 font-medium">Town</th>
                    <th className="pb-2 pr-4 font-medium">Tag</th>
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Category</th>
                    <th className="pb-2 font-medium">Linked to a live place?</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.featured.map((rec) => (
                    <tr key={rec.id} className="border-b border-border-subtle last:border-0">
                      <td className="py-2.5 pr-4 text-stone-700">{rec.townName}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant="brand">{rec.tag.replaceAll("_", " ").toLowerCase()}</Badge>
                      </td>
                      <td className="py-2.5 pr-4 font-medium text-foreground">{rec.name}</td>
                      <td className="py-2.5 pr-4 text-stone-600">{rec.category.toLowerCase()}</td>
                      <td className="py-2.5 text-stone-500">{rec.linkedToLivePlace ? "Yes" : "Not yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>How to promote a user to admin</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed text-stone-600">
          There&apos;s no self-service admin invite flow yet - this page exists for one operator. To grant
          access, set that user&apos;s <code className="rounded bg-surface-muted px-1 py-0.5">role</code> column
          to <code className="rounded bg-surface-muted px-1 py-0.5">ADMIN</code> directly (Prisma Studio, or{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5">
            UPDATE &quot;User&quot; SET role = &apos;ADMIN&apos; WHERE email = &apos;you@example.com&apos;;
          </code>
          ).
        </CardContent>
      </Card>
    </div>
  );
}
