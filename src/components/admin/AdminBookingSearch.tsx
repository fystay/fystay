"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { formatPrice, formatStayDate } from "@/lib/format";

// Mirrors the JSON shape of GET /api/admin/bookings, not the Prisma type
// directly - dates arrive as ISO strings once they've crossed a fetch.
type BookingSearchResult = {
  id: string;
  reference: string;
  checkIn: string;
  checkOut: string;
  status: string;
  paymentStatus: string;
  totalPriceCents: number;
  guestName: string | null;
  guestEmail: string | null;
  listing: { title: string; host: { name: string; email: string } };
  guest: { name: string; email: string };
};

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  PENDING: "warning",
  CONFIRMED: "success",
  CANCELLED: "neutral",
  COMPLETED: "brand",
  REFUNDED: "neutral",
};

/**
 * Support's booking lookup - by reference, guest name/email, or host
 * name/email. Hits GET /api/admin/bookings on submit (not live-as-you-type;
 * this is a support tool used a handful of times a session, not a
 * type-ahead surface) and links each result to its detail page.
 */
export function AdminBookingSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BookingSearchResult[] | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/admin/bookings?q=${encodeURIComponent(query)}`);
    const data = await res.json().catch(() => null);
    setLoading(false);
    setSearched(true);

    if (!res.ok) {
      setResults(null);
      toast.error(data?.error ?? "Search failed");
      return;
    }
    setResults(data.bookings);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Booking reference, guest email/name, or host email/name"
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
              <p className="p-5 text-sm text-stone-500">No bookings matched &quot;{query}&quot;.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs font-medium uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3">Reference</th>
                      <th className="px-4 py-3">Listing</th>
                      <th className="px-4 py-3">Guest</th>
                      <th className="px-4 py-3">Host</th>
                      <th className="px-4 py-3">Check-in</th>
                      <th className="px-4 py-3">Total</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((booking) => (
                      <tr key={booking.id} className="border-b border-border-subtle last:border-0">
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/bookings/${booking.id}`}
                            className="font-mono text-xs font-medium text-brand-700 hover:underline"
                          >
                            {booking.reference}
                          </Link>
                        </td>
                        <td className="max-w-[180px] truncate px-4 py-3 text-stone-700">
                          {booking.listing.title}
                        </td>
                        <td className="px-4 py-3 text-stone-700">
                          {booking.guestName ?? booking.guest.name}
                          <div className="text-xs text-stone-500">
                            {booking.guestEmail ?? booking.guest.email}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-stone-700">
                          {booking.listing.host.name}
                          <div className="text-xs text-stone-500">{booking.listing.host.email}</div>
                        </td>
                        <td className="px-4 py-3 text-stone-700">
                          {formatStayDate(booking.checkIn)}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-stone-700">
                          {formatPrice(booking.totalPriceCents)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[booking.status] ?? "neutral"}>
                            {booking.status}
                          </Badge>
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
