import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/AdminNav";
import { AddPropertyForm } from "@/components/onboarding/AddPropertyForm";
import { isListingAiDraftConfigured } from "@/lib/listingAiDraft";

export const metadata: Metadata = { title: "Add a property", robots: { index: false } };

/**
 * Step one of admin-assisted onboarding: who owns the property, and its
 * working title and town. The rest is filled in on the draft itself.
 * Existing hosts are found by name or email; anyone else is invited.
 */
export default async function AddPropertyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/properties/new");
  if (session.user.role !== "ADMIN") redirect("/");

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const hosts = q
    ? await prisma.user.findMany({
        where: {
          role: "HOST",
          deletedAt: null,
          OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }],
        },
        select: { id: true, name: true, email: true, suspendedAt: true },
        orderBy: { name: "asc" },
        take: 10,
      })
    : [];

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/admin/properties" className="text-sm font-medium text-brand-700 hover:underline">
        ← Properties
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">Add a property</h1>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">
        Start a private draft for a property owner. Nobody is contacted and nothing is public until you choose to send it.
      </p>
      <div className="mt-6">
        <AdminNav active="/admin/properties" />
      </div>

      <section className="mt-8" aria-labelledby="find-host">
        <h2 id="find-host" className="text-lg font-semibold text-foreground">
          1. Who owns it?
        </h2>
        <p className="mt-1 text-sm text-stone-600">Search existing hosts. If the owner isn&apos;t a FYStay host yet, invite them below.</p>
        <form action="/admin/properties/new" className="mt-3 flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Host name or email"
            aria-label="Search hosts"
            className="focus-ring min-w-0 flex-1 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm"
          />
          <button type="submit" className="focus-ring rounded-xl bg-brand-700 px-4 py-2 text-sm font-medium text-white">
            Search
          </button>
        </form>
      </section>

      <AddPropertyForm
        searched={Boolean(q)}
        importEnabled={isListingAiDraftConfigured()}
        hosts={hosts.map((host) => ({ id: host.id, name: host.name, email: host.email, suspended: Boolean(host.suspendedAt) }))}
      />
    </div>
  );
}
