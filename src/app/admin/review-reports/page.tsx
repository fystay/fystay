import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Flag } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SectionHeading } from "@/components/SectionHeading";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { StarRating } from "@/components/ui/StarRating";
import { AdminNav } from "@/components/admin/AdminNav";
import { ReviewReportActions } from "@/components/admin/ReviewReportActions";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Review reports", robots: { index: false } };

type StatusFilter = "OPEN" | "ACTIONED" | "DISMISSED" | "all";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "ACTIONED", label: "Actioned" },
  { value: "DISMISSED", label: "Dismissed" },
  { value: "all", label: "All" },
];

const REPORT_REASON_LABEL: Record<string, string> = {
  spam: "Spam",
  offensive: "Offensive",
  not_genuine: "Not a genuine stay",
  other: "Other",
};

const REPORT_STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  OPEN: "warning",
  ACTIONED: "danger",
  DISMISSED: "neutral",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The admin queue for guest-submitted review reports (see
 * src/app/api/reviews/[id]/report/route.ts - reporting was built there,
 * acting on the report is built here). Every report is shown with the
 * reported review's own content inline so an admin can judge it without
 * clicking through to the listing separately, and can either Dismiss it
 * (leaves the review as-is) or Remove the review (hides it from every
 * public read path - see canActionReport in src/lib/reviews.ts for why a
 * decided report's buttons don't come back).
 */
export default async function AdminReviewReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/review-reports");
  if (session.user.role !== "ADMIN") redirect("/");

  const resolvedSearchParams = await searchParams;
  const statusParam = resolvedSearchParams.status;
  const status: StatusFilter =
    statusParam === "all" ||
    statusParam === "ACTIONED" ||
    statusParam === "DISMISSED" ||
    statusParam === "OPEN"
      ? statusParam
      : "OPEN";

  const reports = await prisma.reviewReport.findMany({
    where: status === "all" ? undefined : { status },
    include: {
      reporter: { select: { name: true, email: true } },
      review: {
        select: {
          id: true,
          rating: true,
          comment: true,
          status: true,
          author: { select: { name: true } },
          listing: { select: { id: true, title: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Review reports</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Reviews guests have flagged for moderation attention. Dismiss a report to leave the
        review as-is, or remove the review to hide it everywhere it&apos;s shown publicly.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/review-reports" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "OPEN" ? "/admin/review-reports" : `/admin/review-reports?status=${tab.value}`}
            className={cn(
              "focus-ring rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              tab.value === status
                ? "border-brand-700 bg-brand-50 text-brand-800"
                : "border-border-subtle text-stone-600 hover:bg-surface-muted",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <SectionHeading icon={Flag}>
          {status === "OPEN" ? "Open reports" : status === "all" ? "All reports" : `${STATUS_TABS.find((t) => t.value === status)?.label} reports`}
        </SectionHeading>
        {reports.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No reports here.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {reports.map((report) => (
              <Card key={report.id}>
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={REPORT_STATUS_VARIANT[report.status]}>{report.status}</Badge>
                        <span className="font-medium text-foreground">
                          {REPORT_REASON_LABEL[report.reason] ?? report.reason}
                        </span>
                      </div>
                      {report.details && (
                        <p className="mt-1 max-w-xl text-sm text-stone-600">{report.details}</p>
                      )}
                      <p className="mt-1 text-xs text-stone-500">
                        Reported by {report.reporter.name ?? "Unknown"} ({report.reporter.email}) on{" "}
                        {dateFormatter.format(report.createdAt)}
                      </p>
                    </div>
                    {report.status === "OPEN" && <ReviewReportActions reportId={report.id} />}
                  </div>

                  <div className="rounded-lg border border-border-subtle bg-surface-muted p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StarRating rating={report.review.rating} />
                        <span className="text-sm font-medium text-foreground">
                          {report.review.author.name ?? "Unknown guest"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {report.review.status === "REMOVED" && (
                          <Badge variant="danger">Removed</Badge>
                        )}
                        <Link
                          href={`/listings/${report.review.listing.id}#reviews`}
                          className="text-sm text-brand-700 hover:underline"
                        >
                          {report.review.listing.title}
                        </Link>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-stone-700">{report.review.comment}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
