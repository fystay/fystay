import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LifeBuoy } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { previewMessage } from "@/lib/messaging";
import { SectionHeading } from "@/components/SectionHeading";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { AdminNav } from "@/components/admin/AdminNav";
import { cn } from "@/lib/cn";
import type { SupportTicketStatus } from "@prisma/client";

export const metadata: Metadata = { title: "Support tickets", robots: { index: false } };

type StatusFilter = SupportTicketStatus | "all";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
  { value: "all", label: "All" },
];

const STATUS_VARIANT: Record<SupportTicketStatus, BadgeProps["variant"]> = {
  OPEN: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The admin queue for general-purpose support tickets (see SupportTicket's
 * own schema comment for how this differs from Disputes and Messages) -
 * defaults to Open, the same "show what needs attention first" convention
 * /admin/review-reports uses.
 */
export default async function AdminSupportTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/support-tickets");
  if (session.user.role !== "ADMIN") redirect("/");

  const resolvedSearchParams = await searchParams;
  const statusParam = resolvedSearchParams.status;
  const status: StatusFilter =
    statusParam === "all" ||
    statusParam === "RESOLVED" ||
    statusParam === "CLOSED" ||
    statusParam === "OPEN"
      ? statusParam
      : "OPEN";

  const tickets = await prisma.supportTicket.findMany({
    where: status === "all" ? undefined : { status },
    include: {
      openedBy: { select: { name: true, email: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Support tickets</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        General-purpose issues raised by guests and hosts - anything that isn&apos;t a Stripe
        chargeback (see Disputes) or a direct message to a host.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/support-tickets" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "OPEN" ? "/admin/support-tickets" : `/admin/support-tickets?status=${tab.value}`}
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
        <SectionHeading icon={LifeBuoy}>
          {status === "all" ? "All tickets" : `${STATUS_TABS.find((t) => t.value === status)?.label} tickets`}
        </SectionHeading>
        {tickets.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No tickets here.</p>
        ) : (
          <Card className="mt-3">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs font-medium uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Opened by</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.map((ticket) => (
                      <tr key={ticket.id} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-3">
                          <Link href={`/admin/support-tickets/${ticket.id}`} className="font-medium text-brand-700 hover:underline">
                            {ticket.subject}
                          </Link>
                          {ticket.messages[0] && (
                            <p className="mt-0.5 max-w-xs truncate text-xs text-stone-500">
                              {previewMessage(ticket.messages[0].body)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-stone-700">
                          {ticket.openedBy.name}
                          <br />
                          <span className="text-xs text-stone-500">{ticket.openedBy.email}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[ticket.status]}>{ticket.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-stone-500">{dateFormatter.format(ticket.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
