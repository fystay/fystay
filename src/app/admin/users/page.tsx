import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserSearch } from "lucide-react";
import { auth } from "@/auth";
import { SectionHeading } from "@/components/SectionHeading";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminUserSearch } from "@/components/admin/AdminUserSearch";

export const metadata: Metadata = { title: "Users", robots: { index: false } };

/** Support's account lookup - by name or email. See src/app/api/admin/users/route.ts for the search itself. */
export default async function AdminUsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/users");
  if (session.user.role !== "ADMIN") redirect("/");

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Users</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Look up a guest or host account to answer a support request.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/users" />
      </div>

      <div className="mt-8">
        <SectionHeading icon={UserSearch}>Search users</SectionHeading>
        <div className="mt-3">
          <AdminUserSearch />
        </div>
      </div>
    </div>
  );
}
