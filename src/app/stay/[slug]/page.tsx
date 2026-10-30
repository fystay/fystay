import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { idSuffixFromSlug, listingSlug } from "@/lib/listingLinks";
import ListingDetailPage, { generateMetadata as listingMetadata } from "@/app/listings/[id]/page";

/**
 * A stay's own shareable address (see src/lib/listingLinks.ts): the same page
 * as /listings/<id>, at a link with its name in it. Search engines are told
 * /listings/<id> is the real address, so the page is never indexed twice.
 */
async function resolve(slug: string): Promise<string | null> {
  const suffix = idSuffixFromSlug(slug);
  if (!suffix) return null;
  const matches = await prisma.listing.findMany({ where: { id: { endsWith: suffix } }, select: { id: true, title: true }, take: 5 });
  const exact = matches.find((listing) => listingSlug(listing) === slug.toLowerCase());
  if (exact) return exact.id;
  // The name was edited since the link was made: the end of the id still finds it.
  if (matches.length === 1) redirect(`/stay/${listingSlug(matches[0])}`);
  return null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const id = await resolve(slug);
  if (!id) return {};
  return listingMetadata({ params: Promise.resolve({ id }) });
}

export default async function StayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const id = await resolve(slug);
  if (!id) notFound();
  return ListingDetailPage({ params: Promise.resolve({ id }), searchParams });
}
