import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Gift } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { REFERRAL_CREDIT_CENTS } from "@/lib/referral";
import { formatPrice } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/Card";
import { ReferralShareCard } from "@/components/ReferralShareCard";
import { BASE_URL } from "@/lib/baseUrl";

export const metadata: Metadata = { title: "Refer a friend", robots: { index: false } };

export default async function ReferPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/refer");
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      referralCode: true,
      creditBalanceCents: true,
      referrals: { select: { referralBonusAwarded: true } },
    },
  });

  const friendsBooked = user.referrals.filter((r) => r.referralBonusAwarded).length;
  const baseUrl = BASE_URL;
  const referralLink = `${baseUrl}/register?ref=${user.referralCode}`;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Gift className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Refer a friend</h1>
          <p className="text-sm text-stone-500">
            Give {formatPrice(REFERRAL_CREDIT_CENTS)}, get {formatPrice(REFERRAL_CREDIT_CENTS)}.
          </p>
        </div>
      </div>

      <p className="mt-4 max-w-lg text-sm text-stone-600">
        Share your invite link. When a friend signs up with it and completes their first paid
        stay, they get {formatPrice(REFERRAL_CREDIT_CENTS)} credit toward their booking and you
        get {formatPrice(REFERRAL_CREDIT_CENTS)} credit toward your next one.
      </p>

      <ReferralShareCard referralCode={user.referralCode} referralLink={referralLink} />

      <div className="mt-6 grid grid-cols-2 gap-4">
        <Card className="p-5">
          <CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Your credit balance
            </p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {formatPrice(user.creditBalanceCents)}
            </p>
            <p className="mt-1 text-xs text-stone-500">Applied automatically at your next checkout.</p>
          </CardContent>
        </Card>
        <Card className="p-5">
          <CardContent className="p-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Friends who&apos;ve booked
            </p>
            <p className="mt-1 text-2xl font-bold text-foreground">{friendsBooked}</p>
            <p className="mt-1 text-xs text-stone-500">Each one earns you another credit.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
