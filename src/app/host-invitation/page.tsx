import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { AcceptInvitationButton } from "@/components/onboarding/AcceptInvitationButton";
import { findInvitationByToken, normalizeEmail } from "@/lib/listingOnboarding";

export const metadata: Metadata = { title: "Your FYStay listing", robots: { index: false, follow: false } };

/**
 * Where an invited owner lands from their email. The link only identifies
 * the invitation: taking over the draft needs them signed in as the invited
 * address, with that address confirmed (see acceptHostInvitation).
 */
export default async function HostInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const [lookup, session] = await Promise.all([findInvitationByToken(prisma, token), auth()]);
  const here = `/host-invitation?token=${encodeURIComponent(token)}`;

  if (lookup.status !== "valid") {
    const message = {
      invalid: "This invitation link isn't valid. Please ask FYStay to send you a new one.",
      expired: "This invitation has expired. Please ask FYStay to send you a new one.",
      accepted: "This invitation has already been accepted. Sign in to see your listing under Hosting → Listings.",
      revoked: "This invitation was withdrawn. Please contact FYStay if you think that's a mistake.",
    }[lookup.status];
    return (
      <Page>
        <h1 className="text-2xl font-bold text-foreground">Invitation unavailable</h1>
        <p className="mt-3 text-stone-700">{message}</p>
        <Link href="/host/listings" className={`${buttonVariants({ variant: "outline" })} mt-6`}>
          Go to my listings
        </Link>
      </Page>
    );
  }

  const { invitation } = lookup;
  const titles = await prisma.listing.findMany({ where: { hostInvitationId: invitation.id }, select: { title: true } });

  const intro = (
    <>
      <h1 className="text-2xl font-bold text-foreground">FYStay has prepared your listing</h1>
      <p className="mt-3 text-stone-700">
        Hi {invitation.name}, we&apos;ve drafted {titles.length === 1 ? <strong>{titles[0].title}</strong> : "your listing"} for you to check.
        It&apos;s private: nothing is shown to guests until you&apos;ve approved it and your payouts are set up.
      </p>
    </>
  );

  if (!session?.user) {
    return (
      <Page>
        {intro}
        <p className="mt-4 text-stone-700">
          Sign in or create your FYStay account using <strong>{invitation.email}</strong>, then come back to this page.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href={`/login?callbackUrl=${encodeURIComponent(here)}`} className={buttonVariants()}>
            Log in
          </Link>
          <Link href={`/register?callbackUrl=${encodeURIComponent(here)}`} className={buttonVariants({ variant: "outline" })}>
            Create an account
          </Link>
        </div>
      </Page>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!user || normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
    return (
      <Page>
        {intro}
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-950">
          You&apos;re signed in as {user?.email ?? "another account"}, but this invitation is for <strong>{invitation.email}</strong>. Log out and
          sign in with the invited address.
        </p>
      </Page>
    );
  }
  if (!user.emailVerifiedAt) {
    return (
      <Page>
        {intro}
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-950">
          Please confirm your email address first - use the link we&apos;ve emailed you (or resend it from your Account page) - then
          reopen this invitation.
        </p>
      </Page>
    );
  }

  return (
    <Page>
      {intro}
      <p className="mt-4 text-stone-700">
        Accepting gives your account access to the draft and turns on hosting. It doesn&apos;t approve or publish anything: you&apos;ll
        check every detail next.
      </p>
      <AcceptInvitationButton token={token} />
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl flex-1 px-6 py-12">
      <Card className="p-6 sm:p-8">{children}</Card>
    </div>
  );
}
