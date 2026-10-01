import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Home } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SectionHeading } from "@/components/SectionHeading";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AdminNav } from "@/components/admin/AdminNav";
import { ListingSuspendActions } from "@/components/admin/ListingSuspendActions";
import { formatDate, formatPrice } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Listings", robots: { index: false } };

type StatusFilter = "live" | "suspended" | "unpublished" | "all";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "suspended", label: "Suspended" },
  { value: "unpublished", label: "Unpublished" },
  { value: "all", label: "All" },
];

const PAGE_SIZE = 50;

/**
 * Listing moderation. Hosts' listings go live as soon as they publish, so
 * this is where an admin finds a fraudulent or problem listing and pulls it
 * from search and booking (or reinstates it) - see the suspend API's own
 * comment for exactly what a suspension does.
 */
export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/listings");
  if (session.user.role !== "ADMIN") redirect("/");

  const params = await searchParams;
  const statusParam = typeof params.status === "string" ? params.status : "live";
  const status: StatusFilter = STATUS_TABS.some((t) => t.value === statusParam)
    ? (statusParam as StatusFilter)
    : "live";
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";

  const statusWhere =
    status === "live"
      ? { published: true, suspendedAt: null }
      : status === "suspended"
        ? { suspendedAt: { not: null } }
        : status === "unpublished"
          ? { published: false }
          : {};
  const searchWhere = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { city: { contains: q, mode: "insensitive" as const } },
          { host: { email: { contains: q, mode: "insensitive" as const } } },
          { id: q },
        ],
      }
    : {};

  const listings = await prisma.listing.findMany({
    where: { ...statusWhere, ...searchWhere },
    select: {
      id: true,
      title: true,
      city: true,
      propertyType: true,
      pricePerNightCents: true,
      published: true,
      suspendedAt: true,
      suspendedReason: true,
      createdAt: true,
      host: { select: { name: true, email: true } },
      _count: { select: { bookings: true } },
    },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
  });

  const tabHref = (value: StatusFilter) => {
    const query = new URLSearchParams();
    if (value !== "live") query.set("status", value);
    if (q) query.set("q", q);
    const s = query.toString();
    return s ? `/admin/listings?${s}` : "/admin/listings";
  };

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Listings</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Every host listing. Suspend one to take it out of search and booking straight away;
        reinstate it once the problem is fixed.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/listings" />
      </div>

      <form action="/admin/listings" className="mt-6 flex gap-2">
        {status !== "live" && <input type="hidden" name="status" value={status} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search title, town, host email or listing ID"
          aria-label="Search listings"
          className="focus-ring min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm"
        />
        <button type="submit" className="focus-ring rounded-xl bg-brand-700 px-4 py-2 text-sm font-medium text-white">
          Search
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tabHref(tab.value)}
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
        <SectionHeading icon={Home}>
          {listings.length === PAGE_SIZE ? `Newest ${PAGE_SIZE} listings` : `${listings.length} listing${listings.length === 1 ? "" : "s"}`}
        </SectionHeading>
        {listings.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No listings here.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {listings.map((listing) => (
              <Card key={listing.id}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/listings/${listing.id}`} className="font-medium text-foreground hover:text-brand-700">
                        {listing.title}
                      </Link>
                      {listing.suspendedAt ? (
                        <Badge variant="danger">Suspended</Badge>
                      ) : listing.published ? (
                        <Badge variant="success">Live</Badge>
                      ) : (
                        <Badge variant="neutral">Unpublished</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-stone-600">
                      {listing.city} · {formatPrice(listing.pricePerNightCents)}/night · {listing._count.bookings} booking
                      {listing._count.bookings === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 break-all text-xs text-stone-500">
                      Host: {listing.host.name ?? "Unnamed"} ({listing.host.email}) · Created {formatDate(listing.createdAt)}
                    </p>
                    {listing.suspendedAt && (
                      <p className="mt-1 text-xs text-red-700">
                        Suspended {formatDate(listing.suspendedAt)}
                        {listing.suspendedReason ? `: ${listing.suspendedReason}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <ListingSuspendActions listingId={listing.id} suspended={Boolean(listing.suspendedAt)} />
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
