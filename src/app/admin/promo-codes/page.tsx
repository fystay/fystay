import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Ticket } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SectionHeading } from "@/components/SectionHeading";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PromoCodeForm } from "@/components/admin/PromoCodeForm";
import { TogglePromoCodeButton } from "@/components/admin/TogglePromoCodeButton";
import { AdminNav } from "@/components/admin/AdminNav";
import { formatDate, formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Promo codes", robots: { index: false } };

function discountLabel(promoCode: { discountType: "PERCENT" | "FIXED"; discountValue: number }): string {
  return promoCode.discountType === "PERCENT"
    ? `${promoCode.discountValue}% off`
    : `${formatPrice(promoCode.discountValue)} off`;
}

/**
 * Platform-wide marketing codes, created and managed only by an ADMIN - a
 * host can't create their own (a confirmed product decision). Every
 * booking that used a code has already snapshotted its own discount (see
 * Booking.promoDiscountCents), so this page only ever affects future
 * redemptions, never rewrites what a past guest paid.
 */
export default async function AdminPromoCodesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=/admin/promo-codes");
  if (session.user.role !== "ADMIN") redirect("/");

  const promoCodes = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
  const now = new Date();

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Promo codes</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
        Platform-wide marketing codes a guest can enter when booking - created here, not by
        hosts.
      </p>

      <div className="mt-6">
        <AdminNav active="/admin/promo-codes" />
      </div>

      <div className="mt-6">
        <PromoCodeForm />
      </div>

      <div className="mt-8">
        <SectionHeading icon={Ticket}>All codes</SectionHeading>
        {promoCodes.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No promo codes yet.</p>
        ) : (
          <Card className="mt-3">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-xs font-medium uppercase tracking-wide text-stone-500">
                      <th className="px-4 py-3">Code</th>
                      <th className="px-4 py-3">Discount</th>
                      <th className="px-4 py-3">Redemptions</th>
                      <th className="px-4 py-3">Expires</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {promoCodes.map((promoCode) => {
                      const expired = promoCode.expiresAt !== null && promoCode.expiresAt < now;
                      const exhausted =
                        promoCode.maxRedemptions !== null &&
                        promoCode.redemptionCount >= promoCode.maxRedemptions;
                      return (
                        <tr key={promoCode.id} className="border-b border-border-subtle last:border-0">
                          <td className="px-4 py-3">
                            <p className="font-mono font-semibold text-foreground">{promoCode.code}</p>
                            {promoCode.description && (
                              <p className="text-xs text-stone-500">{promoCode.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-stone-700">{discountLabel(promoCode)}</td>
                          <td className="px-4 py-3 tabular-nums text-stone-700">
                            {promoCode.redemptionCount}
                            {promoCode.maxRedemptions !== null ? ` / ${promoCode.maxRedemptions}` : ""}
                          </td>
                          <td className="px-4 py-3 text-stone-700">
                            {promoCode.expiresAt ? formatDate(promoCode.expiresAt) : "Never"}
                          </td>
                          <td className="px-4 py-3">
                            {!promoCode.active ? (
                              <Badge variant="neutral">Deactivated</Badge>
                            ) : expired ? (
                              <Badge variant="warning">Expired</Badge>
                            ) : exhausted ? (
                              <Badge variant="warning">Limit reached</Badge>
                            ) : (
                              <Badge variant="success">Active</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <TogglePromoCodeButton id={promoCode.id} active={promoCode.active} />
                          </td>
                        </tr>
                      );
                    })}
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
