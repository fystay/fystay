import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ListingForm } from "@/components/ListingForm";

export const metadata: Metadata = {
  title: "Create a listing",
  robots: { index: false },
};

export default async function NewListingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/host/listings/new");
  if (session.user.role !== "HOST") redirect("/host");

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <h1 className="mb-6 text-2xl font-bold">Create a listing</h1>
      <ListingForm />
    </div>
  );
}
