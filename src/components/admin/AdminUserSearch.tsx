"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";

const ROLE_VARIANT: Record<string, BadgeProps["variant"]> = {
  ADMIN: "brand",
  HOST: "success",
  GUEST: "neutral",
};

// Mirrors the JSON shape of GET /api/admin/users.
type UserSearchResult = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  deletedAt: string | null;
  _count: { bookings: number; listings: number };
};

/** Support's account lookup - by name or email. Same submit-on-search shape as AdminBookingSearch. */
export function AdminUserSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<UserSearchResult[] | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`);
    const data = await res.json().catch(() => null);
    setLoading(false);
    setSearched(true);

    if (!res.ok) {
      setResults(null);
      toast.error(data?.error ?? "Search failed");
      return;
    }
    setResults(data.users);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or email"
          className="max-w-md"
        />
        <Button type="submit" loading={loading}>
          <Search className="h-4 w-4" />
          Search
        </Button>
      </form>

      {searched && results !== null && (
        <Card>
          <CardContent className="p-0">
            {results.length === 0 ? (
              <p className="p-5 text-sm text-stone-500">No users matched &quot;{query}&quot;.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs font-medium uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Bookings</th>
                      <th className="px-4 py-3">Listings</th>
                      <th className="px-4 py-3">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((user) => (
                      <tr key={user.id} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/users/${user.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {user.name}
                          </Link>
                          {user.deletedAt && (
                            <Badge variant="neutral" className="ml-2">
                              Deleted
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-stone-700">{user.email}</td>
                        <td className="px-4 py-3">
                          <Badge variant={ROLE_VARIANT[user.role] ?? "neutral"}>{user.role}</Badge>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-stone-700">{user._count.bookings}</td>
                        <td className="px-4 py-3 tabular-nums text-stone-700">{user._count.listings}</td>
                        <td className="px-4 py-3 text-stone-500">
                          {formatDate(user.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
